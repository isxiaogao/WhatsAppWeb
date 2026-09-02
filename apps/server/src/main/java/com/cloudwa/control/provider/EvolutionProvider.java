package com.cloudwa.control.provider;

import com.cloudwa.control.config.WaControlProperties;
import com.cloudwa.control.domain.*;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

@Component
public class EvolutionProvider implements WhatsAppProvider {
    private final EvolutionClient client;
    private final String webhookBaseUrl;
    private final String webhookSecret;
    private final long pollIntervalMs;
    private final long connectRetryMinDelayMs;
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    public EvolutionProvider(EvolutionClient client, WaControlProperties properties) {
        this.client = client;
        this.webhookBaseUrl = properties.evolution().publicWebhookUrl().replaceAll("/$", "");
        this.webhookSecret = properties.evolution().webhookSecret();
        this.pollIntervalMs = properties.evolution().pollInterval().toMillis();
        this.connectRetryMinDelayMs = properties.evolution().connectRetryMinDelay().toMillis();
    }

    @Override
    public void connect(Account account, ProviderSink sink) {
        Session current = sessions.get(account.id());
        if (current != null) {
            current.account = account;
            current.sink = sink;
            return;
        }
        Session session = new Session(account, sink);
        sessions.put(account.id(), session);
        emitStatus(session, AccountStatus.STARTING, null);
        CompletableFuture.runAsync(() -> run(session));
    }

    @Override
    public void disconnect(Account account) {
        stop(account.id());
        try {
            client.logoutInstance(account.evolution().instanceName());
        } catch (RuntimeException error) {
            if (!notFound(error)) throw error;
        }
    }

    @Override
    public void deleteInstance(Account account) {
        stop(account.id());
        try {
            client.deleteInstance(account.evolution().instanceName());
        } catch (RuntimeException error) {
            if (!notFound(error)) throw error;
        }
    }

    @Override
    public SendResult sendText(Account account, String conversationId, String text) {
        Object result = client.sendText(account.evolution().instanceName(), toEvolutionNumber(conversationId), text);
        return new SendResult(extractMessageId(result));
    }

    @Override
    public SendResult sendMedia(Account account, String conversationId, SendMediaInput input) {
        Object result = client.sendMedia(account.evolution().instanceName(), toEvolutionNumber(conversationId),
                input.kind() == MediaKind.IMAGE ? "image" : "video", input.mimeType(), input.body(), input.caption(), input.fileName());
        return new SendResult(extractMessageId(result));
    }

    @Override
    public void updateProfilePicture(Account account, String pictureBase64) {
        client.updateProfilePicture(account.evolution().instanceName(), pictureBase64);
    }

    @Override
    public void removeProfilePicture(Account account) {
        client.removeProfilePicture(account.evolution().instanceName());
    }

    @Override
    public void handleWebhook(Account account, Map<String, Object> payload) {
        Session session = sessions.get(account.id());
        if (session == null) return;
        String event = normalizeEvent(string(payload, "event"));
        Object data = value(payload, "data");
        if (data == null) data = payload;
        if ("qrcode.updated".equals(event)) {
            String qr = extractQrDataUrl(data);
            if (qr != null) {
                session.hasQr = true;
                session.sink.onQr(account.id(), qr);
            }
            emitStatus(session, AccountStatus.QR_REQUIRED, null);
            return;
        }
        if ("connection.update".equals(event)) {
            handleConnectionState(session, first(string(data, "state"), string(data, "status")));
            return;
        }
        if (Set.of("messages.upsert", "send.message", "messages.set", "messages.update").contains(event)) {
            boolean updateOnly = "messages.update".equals(event);
            for (Object item : unwrapArray(data)) emitMessage(session, item, updateOnly);
            return;
        }
        if (Set.of("chats.upsert", "chats.update", "chats.set").contains(event)) {
            boolean updateOnly = "chats.update".equals(event);
            for (Object item : unwrapArray(data)) {
                ProviderConversation conversation = normalizeConversation(item, updateOnly);
                if (conversation != null) session.sink.onConversation(account.id(), conversation);
            }
        }
    }

    @Override
    public ProviderHealth health() {
        try {
            Object result = client.health();
            return new ProviderHealth(true, client.baseUrl, string(result, "version"), null);
        } catch (RuntimeException error) {
            return new ProviderHealth(false, client.baseUrl, null, error.getMessage());
        }
    }

    private void run(Session session) {
        try {
            ensureInstance(session);
            client.setWebhook(session.account.evolution().instanceName(), webhookBaseUrl + "/api/webhooks/evolution/" + session.account.id(), webhookSecret);
            while (!session.stopped) {
                try {
                    Object result = client.connectionState(session.account.evolution().instanceName());
                    handlePolledState(session, string(firstValue(value(result, "instance"), result), "state"));
                } catch (RuntimeException error) {
                    if (!session.stopped) emitStatus(session, AccountStatus.ERROR, error.getMessage());
                }
                Thread.sleep(pollIntervalMs);
            }
        } catch (Exception error) {
            if (!session.stopped) emitStatus(session, AccountStatus.ERROR, error.getMessage());
        }
    }

    private void ensureInstance(Session session) {
        Optional<Object> existing = unwrapArray(client.fetchInstances()).stream()
                .filter(item -> session.account.evolution().instanceName().equals(instanceNameOf(item))).findFirst();
        if (existing.isPresent()) {
            String id = instanceIdOf(existing.get());
            if (id != null) session.sink.onInstance(session.account.id(), id);
            return;
        }
        Object created = client.createInstance(session.account.evolution().instanceName());
        Object instance = firstValue(value(created, "instance"), created);
        String id = instanceIdOf(instance);
        if (id != null) session.sink.onInstance(session.account.id(), id);
        String qr = extractQrDataUrl(firstValue(value(created, "qrcode"), created));
        if (qr != null) {
            session.hasQr = true;
            session.sink.onQr(session.account.id(), qr);
            emitStatus(session, AccountStatus.QR_REQUIRED, null);
        }
    }

    private void handlePolledState(Session session, String state) {
        String normalized = state == null ? "" : state.toLowerCase();
        if ("open".equals(normalized)) {
            session.hasQr = false;
            session.lastConnectAttemptAt = 0;
            emitStatus(session, AccountStatus.ONLINE, null);
            if (!session.synced) {
                session.synced = true;
                syncIdentity(session);
                syncRecentData(session);
            }
            return;
        }
        session.synced = false;
        if ("connecting".equals(normalized)) {
            emitStatus(session, session.hasQr ? AccountStatus.QR_REQUIRED : AccountStatus.STARTING, null);
            return;
        }
        Object result = requestConnection(session);
        String qr = result == null ? null : extractQrDataUrl(result);
        if (qr != null) {
            session.hasQr = true;
            session.sink.onQr(session.account.id(), qr);
        }
        emitStatus(session, session.hasQr ? AccountStatus.QR_REQUIRED : AccountStatus.STARTING, null);
    }

    private Object requestConnection(Session session) {
        long now = System.currentTimeMillis();
        long retryAfter = Math.max(pollIntervalMs * 3, connectRetryMinDelayMs);
        if (now - session.lastConnectAttemptAt < retryAfter) return null;
        session.lastConnectAttemptAt = now;
        return client.connectInstance(session.account.evolution().instanceName());
    }

    private void handleConnectionState(Session session, String state) {
        String normalized = state == null ? "" : state.toLowerCase();
        if ("open".equals(normalized)) {
            session.hasQr = false;
            session.lastConnectAttemptAt = 0;
            emitStatus(session, AccountStatus.ONLINE, null);
        } else if ("connecting".equals(normalized)) {
            emitStatus(session, session.hasQr ? AccountStatus.QR_REQUIRED : AccountStatus.STARTING, null);
        } else if ("close".equals(normalized) || "closed".equals(normalized)) {
            session.synced = false;
            emitStatus(session, AccountStatus.QR_REQUIRED, null);
        }
    }

    private void syncRecentData(Session session) {
        try {
            List<ProviderConversation> chats = unwrapArray(client.findChats(session.account.evolution().instanceName())).stream()
                    .map(item -> normalizeConversation(item, false)).filter(Objects::nonNull).toList();
            chats.forEach(chat -> session.sink.onConversation(session.account.id(), chat));
            chats.stream().limit(12).forEach(chat -> unwrapArray(client.findMessages(session.account.evolution().instanceName(), chat.id()))
                    .forEach(item -> emitMessage(session, item, false)));
        } catch (RuntimeException ignored) {
        }
    }

    private void syncIdentity(Session session) {
        try {
            unwrapArray(client.fetchInstances()).stream()
                    .filter(item -> session.account.evolution().instanceName().equals(instanceNameOf(item)))
                    .findFirst()
                    .map(item -> first(string(item, "ownerJid"), string(item, "number"), string(value(item, "instance"), "ownerJid")))
                    .filter(Objects::nonNull)
                    .ifPresent(owner -> session.sink.onIdentity(session.account.id(), displayJid(owner)));
        } catch (RuntimeException ignored) {
        }
    }

    private void emitMessage(Session session, Object input, boolean updateOnly) {
        ProviderMessage message = normalizeMessage(input, updateOnly);
        if (message == null) return;
        if (message.media() != null && message.media().base64() == null && !updateOnly) {
            try {
                Object downloaded = client.getBase64FromMediaMessage(session.account.evolution().instanceName(), input);
                message = new ProviderMessage(message.providerMessageId(), message.conversationId(), message.direction(), message.kind(),
                        message.body(), new ProviderMedia(message.media().kind(), first(string(downloaded, "mimetype"), message.media().mimeType()),
                        first(string(downloaded, "fileName"), message.media().fileName()), number(downloaded, "fileLength", message.media().size()),
                        normalizeBase64(string(downloaded, "base64"))), message.createdAt(), message.status());
            } catch (RuntimeException ignored) {
            }
        }
        String pushName = string(input, "pushName");
        if (pushName != null) {
            session.sink.onConversation(session.account.id(), new ProviderConversation(message.conversationId(), pushName,
                    displayJid(message.conversationId()), null, null, null, message.conversationId().endsWith("@g.us")));
        }
        session.sink.onMessage(session.account.id(), message);
    }

    private void emitStatus(Session session, AccountStatus status, String error) {
        if (session.lastStatus == status && status != AccountStatus.ERROR) return;
        session.lastStatus = status;
        session.sink.onStatus(session.account.id(), status, error);
    }

    private void stop(String accountId) {
        Session session = sessions.remove(accountId);
        if (session != null) session.stopped = true;
    }

    private static ProviderConversation normalizeConversation(Object input, boolean updateOnly) {
        String id = first(string(input, "remoteJid"), string(input, "id"), string(value(input, "key"), "remoteJid"));
        if (id == null || "status@broadcast".equals(id)) return null;
        if (updateOnly && !hasConversationUpdatePayload(input)) return null;
        Object lastMessage = value(input, "lastMessage");
        return new ProviderConversation(id, first(string(input, "name"), string(input, "pushName"), string(input, "subject"), displayJid(id)),
                displayJid(id), extractText(firstValue(lastMessage, input)), toIso(firstValue(value(input, "updatedAt"), value(input, "messageTimestamp"), value(lastMessage, "messageTimestamp"))),
                (int) number(input, "unreadMessages", number(input, "unreadCount", 0)), id.endsWith("@g.us"));
    }

    private static boolean hasConversationUpdatePayload(Object input) {
        if (!(input instanceof Map<?, ?> map)) return false;
        return map.keySet().stream()
                .map(String::valueOf)
                .anyMatch(key -> Set.of("name", "pushName", "subject", "lastMessage", "updatedAt", "messageTimestamp", "unreadMessages", "unreadCount").contains(key));
    }

    private static ProviderMessage normalizeMessage(Object input, boolean updateOnly) {
        Object key = firstValue(value(input, "key"), value(value(input, "message"), "key"));
        String conversationId = first(string(key, "remoteJid"), string(input, "remoteJid"), string(input, "conversationId"));
        if (conversationId == null || "status@broadcast".equals(conversationId)) return null;
        boolean fromMe = bool(key, "fromMe", bool(input, "fromMe", false));
        ProviderMedia media = extractMedia(input);
        String extracted = extractText(firstValue(value(input, "message"), input));
        String body = !extracted.isBlank() ? extracted : media == null ? "" : media.kind() == MediaKind.IMAGE ? "[图片]" : "[视频]";
        String providerMessageId = first(string(key, "id"), string(input, "id"), string(input, "keyId"));
        if (body.isBlank() && (!updateOnly || providerMessageId == null)) return null;
        return new ProviderMessage(providerMessageId, conversationId, fromMe ? MessageDirection.OUT : MessageDirection.IN,
                media == null ? MessageKind.TEXT : (media.kind() == MediaKind.IMAGE ? MessageKind.IMAGE : MessageKind.VIDEO), body, media,
                toIso(firstValue(value(input, "messageTimestamp"), value(input, "timestamp"))), mapStatus(fromMe, firstValue(value(input, "status"), value(input, "update"))));
    }

    private static ProviderMedia extractMedia(Object input) {
        Object message = unwrapMessage(firstValue(value(input, "message"), input));
        for (String field : List.of("imageMessage", "videoMessage")) {
            Object media = value(message, field);
            if (!(media instanceof Map<?, ?>)) continue;
            MediaKind kind = field.startsWith("image") ? MediaKind.IMAGE : MediaKind.VIDEO;
            return new ProviderMedia(kind, first(string(media, "mimetype"), string(media, "mime_type"), kind == MediaKind.IMAGE ? "image/jpeg" : "video/mp4"),
                    first(string(media, "fileName"), kind == MediaKind.IMAGE ? "image.jpg" : "video.mp4"),
                    number(media, "fileLength", 0),
                    normalizeBase64(first(string(message, "base64"), string(input, "base64"), string(media, "base64"))));
        }
        return null;
    }

    private static Object unwrapMessage(Object input) {
        Object current = input;
        for (int i = 0; i < 5 && current instanceof Map<?, ?>; i++) {
            if (value(current, "imageMessage") instanceof Map<?, ?> || value(current, "videoMessage") instanceof Map<?, ?>)
                return current;
            Object wrapper = firstValue(value(current, "ephemeralMessage"), value(current, "viewOnceMessage"), value(current, "viewOnceMessageV2"),
                    value(current, "viewOnceMessageV2Extension"), value(current, "documentWithCaptionMessage"));
            if (!(wrapper instanceof Map<?, ?>)) return current;
            current = firstValue(value(wrapper, "message"), wrapper);
        }
        return current;
    }

    private static String extractText(Object input) {
        if (input instanceof String text) return text;
        String direct = first(string(input, "conversation"), string(input, "text"), string(input, "caption"), string(input, "body"));
        if (direct != null) return direct;
        for (String key : List.of("extendedTextMessage", "imageMessage", "videoMessage", "documentMessage", "buttonsResponseMessage", "listResponseMessage")) {
            Object nested = value(input, key);
            String text = first(string(nested, "text"), string(nested, "caption"), string(nested, "title"), string(nested, "selectedDisplayText"));
            if (text != null) return text;
        }
        if (input instanceof Map<?, ?> map) {
            return map.keySet().stream().map(String::valueOf).filter(key -> key.endsWith("Message")).findFirst().map(key -> "[" + key.replaceAll("Message$", "") + "]").orElse("");
        }
        return "";
    }

    private static MessageStatus mapStatus(boolean fromMe, Object input) {
        if (!fromMe) return MessageStatus.RECEIVED;
        String value = String.valueOf(input == null ? "" : input).toUpperCase();
        if (value.contains("READ") || "4".equals(value)) return MessageStatus.READ;
        if (value.contains("DELIVER") || "3".equals(value)) return MessageStatus.DELIVERED;
        if (value.contains("ERROR") || value.contains("FAIL")) return MessageStatus.FAILED;
        return MessageStatus.SENT;
    }

    private static List<Object> unwrapArray(Object input) {
        if (input instanceof List<?> list) return new ArrayList<>(list);
        Object[] candidates = {
                value(input, "records"),
                value(input, "chats"),
                value(input, "data"),
                value(input, "messages"),
                value(value(input, "messages"), "records")
        };
        for (Object candidate : candidates) {
            if (candidate instanceof List<?> list) return new ArrayList<>(list);
        }
        return input == null ? List.of() : List.of(input);
    }

    private static String extractQrDataUrl(Object input) {
        String value = first(string(input, "base64"), string(value(input, "qrcode"), "base64"), string(value(input, "data"), "base64"), string(value(value(input, "data"), "qrcode"), "base64"));
        if (value == null) return null;
        return value.startsWith("data:image/") ? value : "data:image/png;base64," + value;
    }

    private static String extractMessageId(Object input) {
        return first(string(value(input, "key"), "id"), string(value(value(input, "message"), "key"), "id"), string(input, "id"));
    }

    private static String instanceNameOf(Object input) {
        return first(string(input, "name"), string(input, "instanceName"), string(value(input, "instance"), "instanceName"));
    }

    private static String instanceIdOf(Object input) {
        return first(string(input, "id"), string(input, "instanceId"), string(value(input, "instance"), "instanceId"));
    }

    private static String toEvolutionNumber(String id) {
        return id.endsWith("@g.us") ? id : id.replaceAll("@(s\\.whatsapp\\.net|c\\.us)$", "");
    }

    private static String displayJid(String value) {
        String bare = value.replaceAll("@(s\\.whatsapp\\.net|c\\.us|g\\.us)$", "");
        return bare.matches("^\\d+$") ? "+" + bare : bare;
    }

    private static String normalizeEvent(String value) {
        return value == null ? "" : value.trim().toLowerCase().replace("_", ".");
    }

    private static String normalizeBase64(String value) {
        return value == null ? null : value.replaceFirst("^.*base64,", "");
    }

    private static String toIso(Object value) {
        if (value instanceof String text && (text.contains("T") || text.contains("-"))) {
            try {
                return Instant.parse(text).toString();
            } catch (RuntimeException ignored) {
            }
        }
        try {
            long numeric = Long.parseLong(String.valueOf(value));
            if (numeric > 0)
                return Instant.ofEpochMilli(numeric < 10_000_000_000L ? numeric * 1000 : numeric).toString();
        } catch (RuntimeException ignored) {
        }
        return Instant.now().toString();
    }

    private static Object value(Object input, String key) {
        return input instanceof Map<?, ?> map ? map.get(key) : null;
    }

    private static String string(Object input, String key) {
        Object value = value(input, key);
        return value instanceof String text && !text.isBlank() ? text : null;
    }

    private static long number(Object input, String key, long fallback) {
        Object value = value(input, key);
        if (value instanceof Number number) return number.longValue();
        try {
            return value == null ? fallback : Long.parseLong(String.valueOf(value));
        } catch (RuntimeException error) {
            return fallback;
        }
    }

    private static boolean bool(Object input, String key, boolean fallback) {
        Object value = value(input, key);
        return value instanceof Boolean bool ? bool : fallback;
    }

    private static Object firstValue(Object... values) {
        return Arrays.stream(values).filter(Objects::nonNull).findFirst().orElse(null);
    }

    private static String first(String... values) {
        return Arrays.stream(values).filter(v -> v != null && !v.isBlank()).findFirst().orElse(null);
    }

    private static boolean notFound(RuntimeException error) {
        return error.getMessage() != null && error.getMessage().contains("404");
    }

    private static class Session {
        Account account;
        ProviderSink sink;
        volatile boolean stopped;
        volatile AccountStatus lastStatus;
        volatile boolean synced;
        volatile boolean hasQr;
        volatile long lastConnectAttemptAt;

        Session(Account account, ProviderSink sink) {
            this.account = account;
            this.sink = sink;
        }
    }
}
