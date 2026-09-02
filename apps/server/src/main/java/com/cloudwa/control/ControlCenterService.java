package com.cloudwa.control;

import com.cloudwa.control.config.WaControlProperties;
import com.cloudwa.control.domain.*;
import com.cloudwa.control.provider.*;
import com.cloudwa.control.storage.*;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;

@Service
public class ControlCenterService {
    private final Map<String, Account> accounts = new ConcurrentHashMap<>();
    private final Map<String, Conversation> conversations = new ConcurrentHashMap<>();
    private final Map<String, Message> messages = new ConcurrentHashMap<>();
    private final Map<String, MediaAsset> mediaAssets = new ConcurrentHashMap<>();
    private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();
    private final Map<String, CompletableFuture<Void>> accountOperations = new ConcurrentHashMap<>();
    private final Map<String, AvatarOperation> avatarOperations = new ConcurrentHashMap<>();
    private final WhatsAppProvider provider;
    private final StateStore store;
    private final MediaStorage mediaStorage;
    private final WaControlProperties properties;

    private final ProviderSink sink = new ProviderSink() {
        @Override
        public void onStatus(String accountId, AccountStatus status, String error) {
            updateAccountStatus(accountId, status, error);
        }

        @Override
        public void onQr(String accountId, String qrDataUrl) {
            Account account = requireAccount(accountId);
            saveAccount(copyAccount(account, account.phone(), account.status(), account.lastSeenAt(), qrDataUrl, account.avatarUrl(), account.avatarMediaId(), null, account.evolution()));
        }

        @Override
        public void onIdentity(String accountId, String phone) {
            Account account = requireAccount(accountId);
            saveAccount(copyAccount(account, phone, account.status(), account.lastSeenAt(), account.qrDataUrl(), account.avatarUrl(), account.avatarMediaId(), account.error(), account.evolution()));
        }

        @Override
        public void onAvatarUrl(String accountId, String avatarUrl) {
            syncAccountAvatarUrl(accountId, avatarUrl);
        }

        @Override
        public void onInstance(String accountId, String instanceId) {
            Account account = requireAccount(accountId);
            EvolutionInstance evolution = new EvolutionInstance(account.evolution().instanceName(), instanceId, "WHATSAPP-BAILEYS");
            saveAccount(copyAccount(account, account.phone(), account.status(), account.lastSeenAt(), account.qrDataUrl(), account.avatarUrl(), account.avatarMediaId(), account.error(), evolution));
        }

        @Override
        public void onConversation(String accountId, ProviderConversation conversation) {
            upsertProviderConversation(accountId, conversation);
        }

        @Override
        public void onMessage(String accountId, ProviderMessage message) {
            upsertProviderMessage(accountId, message);
        }
    };

    public ControlCenterService(WhatsAppProvider provider, StateStore store, MediaStorage mediaStorage, WaControlProperties properties) {
        this.provider = provider;
        this.store = store;
        this.mediaStorage = mediaStorage;
        this.properties = properties;
        ControlState state = store.load();
        for (Account account : state.accounts) {
            EvolutionInstance evolution = account.evolution() == null
                    ? new EvolutionInstance(instanceNameFor(account.id()), null, "WHATSAPP-BAILEYS")
                    : new EvolutionInstance(account.evolution().instanceName(), account.evolution().instanceId(), "WHATSAPP-BAILEYS");
            accounts.put(account.id(), copyAccount(account, account.phone(), AccountStatus.OFFLINE, account.lastSeenAt(), null,
                    account.avatarUrl(), account.avatarMediaId(), null, evolution));
        }
        for (Conversation conversation : state.conversations)
            conversations.put(conversationKey(conversation.accountId(), conversation.id()), conversation);
        for (Message message : state.messages) messages.put(message.id(), message);
        for (MediaAsset asset : state.mediaAssets) mediaAssets.put(asset.id(), asset);
        if (!state.accounts.isEmpty()) persist();
    }

    public List<Account> listAccounts() {
        return accounts.values().stream().sorted(Comparator.comparing(Account::createdAt)).toList();
    }

    public Account createAccount(AccountCreateRequest input) {
        String name = input == null || input.name() == null ? "" : input.name().trim();
        if (name.isBlank()) throw new IllegalArgumentException("账号名称不能为空");
        String id = UUID.randomUUID().toString();
        Account account = new Account(id, name, null, AccountStatus.OFFLINE, "evolution", null, null, null, null, null,
                new EvolutionInstance(instanceNameFor(id), null, "WHATSAPP-BAILEYS"), now());
        saveAccount(account);
        return account;
    }

    public void resumeSessions() {
        if (!properties.evolution().autoResume()) return;
        listAccounts().forEach(account -> CompletableFuture.runAsync(() -> connectAccount(account.id())));
    }

    public Account connectAccount(String accountId) {
        Account account = requireAccount(accountId);
        provider.connect(account, sink);
        return requireAccount(accountId);
    }

    public Account disconnectAccount(String accountId) {
        Account account = requireAccount(accountId);
        provider.disconnect(account);
        updateAccountStatus(accountId, AccountStatus.OFFLINE, null);
        return requireAccount(accountId);
    }

    public Map<String, String> deleteAccount(String accountId) {
        Account account = requireAccount(accountId);
        runAccountOperation(accountId, () -> {
            provider.deleteInstance(account);
            return null;
        });
        List<MediaAsset> assets = mediaAssets.values().stream().filter(asset -> asset.accountId().equals(accountId)).toList();
        accounts.remove(accountId);
        conversations.entrySet().removeIf(entry -> entry.getValue().accountId().equals(accountId));
        messages.entrySet().removeIf(entry -> entry.getValue().accountId().equals(accountId));
        assets.forEach(asset -> mediaAssets.remove(asset.id()));
        persist();
        publish(new ControlEvent("account.deleted", Map.of("id", accountId)));
        assets.forEach(asset -> {
            try {
                mediaStorage.delete(asset.storageKey());
            } catch (RuntimeException ignored) {
            }
        });
        return Map.of("id", accountId);
    }

    public List<Conversation> listConversations(String accountId) {
        requireAccount(accountId);
        return conversations.values().stream().filter(c -> c.accountId().equals(accountId))
                .sorted(Comparator.comparing(Conversation::lastMessageAt).reversed()).toList();
    }

    public Conversation createConversation(String accountId, ConversationCreateRequest input) {
        requireAccount(accountId);
        String conversationId = normalizeTarget(input == null ? "" : input.target());
        String key = conversationKey(accountId, conversationId);
        if (conversations.containsKey(key)) return conversations.get(key);
        String title = input != null && input.name() != null && !input.name().trim().isBlank() ? input.name().trim() : displayTarget(conversationId);
        Conversation conversation = new Conversation(conversationId, accountId, title, displayTarget(conversationId), "新建会话",
                now(), 0, conversationId.endsWith("@g.us"), toneFor(conversationId));
        saveConversation(conversation);
        return conversation;
    }

    public List<Message> listMessages(String accountId, String conversationId) {
        requireAccount(accountId);
        return messages.values().stream().filter(m -> m.accountId().equals(accountId) && m.conversationId().equals(conversationId))
                .sorted(Comparator.comparing(Message::createdAt)).toList();
    }

    public Message sendMessage(String accountId, String conversationId, MessageCreateRequest input) {
        Account account = requireAccount(accountId);
        if (account.status() != AccountStatus.ONLINE) throw new IllegalArgumentException("账号当前不在线");
        String text = input == null || input.text() == null ? "" : input.text().trim();
        if (text.isBlank()) throw new IllegalArgumentException("消息内容不能为空");
        if (text.length() > 4096) throw new IllegalArgumentException("消息长度不能超过 4096 字符");
        String clientRef = input.clientRef() == null || input.clientRef().trim().isBlank() ? null : input.clientRef().trim();
        Message existing = findByClientRef(accountId, clientRef);
        if (existing != null) return existing;
        ensureConversation(accountId, conversationId);
        Message message = new Message(UUID.randomUUID().toString(), null, clientRef, accountId, conversationId, MessageDirection.OUT,
                MessageKind.TEXT, text, null, MessageStatus.SENDING, now());
        messages.put(message.id(), message);
        persist();
        publish(new ControlEvent("message.created", message));
        touchConversation(accountId, conversationId, text, false);
        try {
            SendResult result = runAccountOperation(accountId, () -> provider.sendText(account, conversationId, text));
            Message sent = copyMessage(message, result.providerMessageId(), MessageStatus.SENT);
            messages.put(sent.id(), sent);
            persist();
            publish(new ControlEvent("message.updated", sent));
            return sent;
        } catch (RuntimeException error) {
            Message failed = copyMessage(message, null, MessageStatus.FAILED);
            messages.put(failed.id(), failed);
            persist();
            publish(new ControlEvent("message.updated", failed));
            throw error;
        }
    }

    public Message sendMediaMessage(String accountId, String conversationId, UploadedMedia input, String caption, String clientRef) {
        Account account = requireAccount(accountId);
        if (account.status() != AccountStatus.ONLINE) throw new IllegalArgumentException("账号当前不在线");
        String cleanCaption = caption == null ? "" : caption.trim();
        if (cleanCaption.length() > 1024) throw new IllegalArgumentException("媒体说明不能超过 1024 字符");
        Message existing = findByClientRef(accountId, clientRef);
        if (existing != null) return existing;
        ensureConversation(accountId, conversationId);
        MediaAsset asset = storeMedia(accountId, input.kind(), input);
        MediaAttachment attachment = mediaAttachment(asset);
        String preview = cleanCaption.isBlank() ? mediaLabel(input.kind()) : cleanCaption;
        Message message = new Message(UUID.randomUUID().toString(), null, clientRef, accountId, conversationId, MessageDirection.OUT,
                input.kind() == MediaKind.IMAGE ? MessageKind.IMAGE : MessageKind.VIDEO, preview, attachment, MessageStatus.SENDING, now());
        messages.put(message.id(), message);
        persist();
        publish(new ControlEvent("message.created", message));
        touchConversation(accountId, conversationId, preview, false);
        try {
            SendResult result = runAccountOperation(accountId, () -> provider.sendMedia(account, conversationId,
                    new SendMediaInput(input.kind(), input.mimeType(), input.fileName(), input.body(), cleanCaption)));
            Message sent = copyMessage(message, result.providerMessageId(), MessageStatus.SENT);
            messages.put(sent.id(), sent);
            persist();
            publish(new ControlEvent("message.updated", sent));
            return sent;
        } catch (RuntimeException error) {
            Message failed = copyMessage(message, null, MessageStatus.FAILED);
            messages.put(failed.id(), failed);
            persist();
            publish(new ControlEvent("message.updated", failed));
            throw error;
        }
    }

    public Account updateAccountAvatar(String accountId, UploadedMedia input) {
        String fingerprint = sha256(input.body());
        AvatarOperation operation;
        synchronized (avatarOperations) {
            AvatarOperation active = avatarOperations.get(accountId);
            if (active != null && active.fingerprint.equals(fingerprint)) return active.future.join();
            CompletableFuture<Account> future = CompletableFuture.supplyAsync(() -> performAccountAvatarUpdate(accountId, input));
            operation = new AvatarOperation(fingerprint, future);
            avatarOperations.put(accountId, operation);
        }
        try {
            return operation.future.join();
        } finally {
            avatarOperations.remove(accountId, operation);
        }
    }

    public Account removeAccountAvatar(String accountId) {
        Account account = requireAccount(accountId);
        if (account.status() != AccountStatus.ONLINE) throw new IllegalArgumentException("账号当前不在线");
        runAccountOperation(accountId, () -> {
            provider.removeProfilePicture(account);
            return null;
        });
        MediaAsset previous = account.avatarMediaId() == null ? null : mediaAssets.get(account.avatarMediaId());
        Account updated = copyAccount(account, account.phone(), account.status(), account.lastSeenAt(), account.qrDataUrl(), null, null, account.error(), account.evolution());
        saveAccount(updated);
        if (previous != null) {
            mediaAssets.remove(previous.id());
            try {
                mediaStorage.delete(previous.storageKey());
            } catch (RuntimeException ignored) {
            }
            persist();
        }
        return updated;
    }

    public MediaRead openMedia(String mediaId, String range) {
        MediaAsset asset = mediaAssets.get(mediaId);
        if (asset == null) throw new IllegalArgumentException("媒体不存在");
        return new MediaRead(asset, mediaStorage.get(asset.storageKey(), range));
    }

    public void handleEvolutionWebhook(String accountId, Map<String, Object> payload) {
        provider.handleWebhook(resolveWebhookAccount(accountId, payload), payload);
    }

    public ProviderHealth getProviderHealth() {
        return provider.health();
    }

    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(0L);
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        try {
            emitter.send(SseEmitter.event().name("connected").data(Map.of("time", now())));
        } catch (Exception ignored) {
        }
        return emitter;
    }

    private Account performAccountAvatarUpdate(String accountId, UploadedMedia input) {
        Account account = requireAccount(accountId);
        if (account.status() != AccountStatus.ONLINE) throw new IllegalArgumentException("账号当前不在线");
        MediaAsset asset = storeMedia(accountId, MediaKind.AVATAR, input);
        try {
            runAccountOperation(accountId, () -> {
                provider.updateProfilePicture(account, Base64.getEncoder().encodeToString(input.body()));
                return null;
            });
        } catch (RuntimeException error) {
            mediaAssets.remove(asset.id());
            mediaStorage.delete(asset.storageKey());
            persist();
            throw error;
        }
        MediaAsset previous = account.avatarMediaId() == null ? null : mediaAssets.get(account.avatarMediaId());
        Account updated = copyAccount(account, account.phone(), account.status(), account.lastSeenAt(), account.qrDataUrl(),
                "/api/media/" + asset.id(), asset.id(), account.error(), account.evolution());
        saveAccount(updated);
        if (previous != null) {
            mediaAssets.remove(previous.id());
            try {
                mediaStorage.delete(previous.storageKey());
            } catch (RuntimeException ignored) {
            }
            persist();
        }
        return updated;
    }

    private void syncAccountAvatarUrl(String accountId, String avatarUrl) {
        if (avatarUrl == null || avatarUrl.isBlank()) return;
        Account account = requireAccount(accountId);
        if (avatarUrl.equals(account.avatarUrl())) return;
        MediaAsset previous = account.avatarMediaId() == null ? null : mediaAssets.get(account.avatarMediaId());
        Account updated = copyAccount(account, account.phone(), account.status(), account.lastSeenAt(), account.qrDataUrl(),
                avatarUrl, null, account.error(), account.evolution());
        saveAccount(updated);
        if (previous != null) {
            mediaAssets.remove(previous.id());
            try {
                mediaStorage.delete(previous.storageKey());
            } catch (RuntimeException ignored) {
            }
            persist();
        }
    }

    private synchronized void persist() {
        ControlState state = new ControlState();
        state.accounts = new ArrayList<>(accounts.values());
        state.conversations = new ArrayList<>(conversations.values());
        state.messages = new ArrayList<>(messages.values());
        state.mediaAssets = new ArrayList<>(mediaAssets.values());
        store.save(state);
    }

    private void publish(ControlEvent event) {
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().name("control").data(event));
            } catch (Exception error) {
                emitters.remove(emitter);
            }
        }
    }

    private void updateAccountStatus(String accountId, AccountStatus status, String error) {
        Account account = requireAccount(accountId);
        String qr = (status == AccountStatus.ONLINE || status == AccountStatus.OFFLINE) ? null : account.qrDataUrl();
        String lastSeen = status == AccountStatus.ONLINE ? now() : account.lastSeenAt();
        saveAccount(copyAccount(account, account.phone(), status, lastSeen, qr, account.avatarUrl(), account.avatarMediaId(), error, account.evolution()));
    }

    private Conversation upsertProviderConversation(String accountId, ProviderConversation input) {
        String key = conversationKey(accountId, input.id());
        Conversation existing = conversations.get(key);
        Conversation conversation = new Conversation(input.id(), accountId,
                first(input.title(), existing == null ? null : existing.title(), displayTarget(input.id())),
                first(input.subtitle(), existing == null ? null : existing.subtitle(), displayTarget(input.id())),
                first(input.lastMessagePreview(), existing == null ? null : existing.lastMessagePreview(), ""),
                first(input.lastMessageAt(), existing == null ? null : existing.lastMessageAt(), now()),
                input.unreadCount() == null ? (existing == null ? 0 : existing.unreadCount()) : input.unreadCount(),
                input.isGroup() == null ? (existing == null ? input.id().endsWith("@g.us") : existing.isGroup()) : input.isGroup(),
                existing == null ? toneFor(input.id()) : existing.avatarTone());
        saveConversation(conversation);
        return conversation;
    }

    private void upsertProviderMessage(String accountId, ProviderMessage input) {
        if (input.providerMessageId() != null) {
            Optional<Message> existing = messages.values().stream()
                    .filter(m -> m.accountId().equals(accountId) && input.providerMessageId().equals(m.providerMessageId())).findFirst();
            if (existing.isPresent()) {
                Message current = existing.get();
                Message updated = new Message(current.id(), current.providerMessageId(), current.clientRef(), current.accountId(), current.conversationId(),
                        current.direction(), input.kind(), input.body().isBlank() ? current.body() : input.body(), current.media(), input.status(), current.createdAt());
                messages.put(updated.id(), updated);
                persist();
                publish(new ControlEvent("message.updated", updated));
                return;
            }
        }
        if (input.body().isBlank() && input.media() == null) return;
        MediaAttachment media = input.media() == null || input.media().base64() == null ? null : mediaAttachment(storeMedia(accountId, input.media().kind(),
                new UploadedMedia(Base64.getDecoder().decode(input.media().base64().replaceFirst("^data:[^;]+;base64,", "")),
                        input.media().fileName(), input.media().mimeType(), input.media().size(), input.media().kind())));
        ensureConversation(accountId, input.conversationId());
        Message message = new Message(UUID.randomUUID().toString(), input.providerMessageId(), null, accountId, input.conversationId(),
                input.direction(), input.kind(), input.body(), media, input.status(), input.createdAt());
        messages.put(message.id(), message);
        persist();
        publish(new ControlEvent("message.created", message));
        touchConversation(accountId, input.conversationId(), input.body(), input.direction() == MessageDirection.IN);
    }

    private MediaAsset storeMedia(String accountId, MediaKind kind, UploadedMedia input) {
        String id = UUID.randomUUID().toString();
        String storageKey = mediaStorage.put(new StoreMediaInput(id, accountId, kind, input.fileName(), input.mimeType(), input.body()));
        MediaAsset asset = new MediaAsset(id, accountId, kind, storageKey, input.mimeType(), input.fileName(),
                input.size() > 0 ? input.size() : input.body().length, now());
        mediaAssets.put(id, asset);
        persist();
        return asset;
    }

    private <T> T runAccountOperation(String accountId, Supplier<T> action) {
        CompletableFuture<Void> previous = accountOperations.getOrDefault(accountId, CompletableFuture.completedFuture(null));
        CompletableFuture<T> current = previous.handle((ok, err) -> null).thenApplyAsync(ignored -> action.get());
        CompletableFuture<Void> tail = current.handle((ok, err) -> null);
        accountOperations.put(accountId, tail);
        try {
            return current.join();
        } catch (CompletionException error) {
            if (error.getCause() instanceof RuntimeException runtime) throw runtime;
            throw error;
        } finally {
            accountOperations.remove(accountId, tail);
        }
    }

    private Conversation ensureConversation(String accountId, String conversationId) {
        String key = conversationKey(accountId, conversationId);
        Conversation existing = conversations.get(key);
        if (existing != null) return existing;
        return createConversation(accountId, new ConversationCreateRequest(conversationId, null));
    }

    private void touchConversation(String accountId, String conversationId, String preview, boolean incrementUnread) {
        Conversation conversation = ensureConversation(accountId, conversationId);
        saveConversation(new Conversation(conversation.id(), accountId, conversation.title(), conversation.subtitle(), preview, now(),
                conversation.unreadCount() + (incrementUnread ? 1 : 0), conversation.isGroup(), conversation.avatarTone()));
    }

    private void saveAccount(Account account) {
        accounts.put(account.id(), account);
        persist();
        publish(new ControlEvent("account.updated", account));
    }

    private void saveConversation(Conversation conversation) {
        conversations.put(conversationKey(conversation.accountId(), conversation.id()), conversation);
        persist();
        publish(new ControlEvent("conversation.updated", conversation));
    }

    private Account requireAccount(String accountId) {
        Account account = accounts.get(accountId);
        if (account == null) throw new IllegalArgumentException("账号不存在");
        return account;
    }

    private Account resolveWebhookAccount(String accountId, Map<String, Object> payload) {
        Account direct = accounts.get(accountId);
        if (direct != null) return direct;
        Set<String> identities = webhookIdentities(payload);
        return accounts.values().stream()
                .filter(account -> account.evolution() != null)
                .filter(account -> identities.contains(account.evolution().instanceId()) || identities.contains(account.evolution().instanceName()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("账号不存在"));
    }

    private static Set<String> webhookIdentities(Map<String, Object> payload) {
        Set<String> identities = new HashSet<>();
        collectWebhookIdentity(payload, identities);
        collectWebhookIdentity(value(payload, "data"), identities);
        collectWebhookIdentity(value(payload, "instance"), identities);
        return identities;
    }

    private static void collectWebhookIdentity(Object input, Set<String> identities) {
        for (String key : List.of("instanceId", "instanceName", "instance")) {
            Object value = value(input, key);
            if (value instanceof String text && !text.isBlank()) identities.add(text);
        }
    }

    private Message findByClientRef(String accountId, String clientRef) {
        if (clientRef == null || clientRef.isBlank()) return null;
        return messages.values().stream().filter(m -> m.accountId().equals(accountId) && clientRef.equals(m.clientRef())).findFirst().orElse(null);
    }

    private static Account copyAccount(Account a, String phone, AccountStatus status, String lastSeenAt, String qrDataUrl,
                                       String avatarUrl, String avatarMediaId, String error, EvolutionInstance evolution) {
        return new Account(a.id(), a.name(), phone, status, "evolution", lastSeenAt, qrDataUrl, avatarUrl, avatarMediaId, error, evolution, a.createdAt());
    }

    private static Message copyMessage(Message m, String providerMessageId, MessageStatus status) {
        return new Message(m.id(), providerMessageId, m.clientRef(), m.accountId(), m.conversationId(), m.direction(), m.kind(), m.body(), m.media(), status, m.createdAt());
    }

    private static MediaAttachment mediaAttachment(MediaAsset asset) {
        if (asset.kind() == MediaKind.AVATAR) throw new IllegalArgumentException("头像不能作为消息附件");
        return new MediaAttachment(asset.id(), asset.kind(), "/api/media/" + asset.id(), asset.mimeType(), asset.fileName(), asset.size());
    }

    private static String normalizeTarget(String target) {
        String trimmed = target == null ? "" : target.trim();
        if (trimmed.endsWith("@s.whatsapp.net") || trimmed.endsWith("@c.us") || trimmed.endsWith("@g.us")) {
            return trimmed.replaceAll("@c\\.us$", "@s.whatsapp.net");
        }
        String digits = trimmed.replaceAll("\\D", "");
        if (digits.length() < 8 || digits.length() > 20)
            throw new IllegalArgumentException("请输入含国家区号的有效号码");
        return digits + "@s.whatsapp.net";
    }

    private static String displayTarget(String target) {
        return "+" + target.replaceAll("@(s\\.whatsapp\\.net|c\\.us|g\\.us)$", "");
    }

    private static String conversationKey(String accountId, String conversationId) {
        return accountId + "::" + conversationId;
    }

    private static String toneFor(String value) {
        String[] tones = {"amber", "mint", "blue", "rose"};
        int total = value.chars().sum();
        return tones[Math.floorMod(total, tones.length)];
    }

    private static String instanceNameFor(String accountId) {
        return "wa_" + accountId.replace("-", "");
    }

    private static String mediaLabel(MediaKind kind) {
        return kind == MediaKind.IMAGE ? "[图片]" : "[视频]";
    }

    private static Object value(Object input, String key) {
        return input instanceof Map<?, ?> map ? map.get(key) : null;
    }

    private static String now() {
        return Instant.now().toString();
    }

    private static String first(String... values) {
        return Arrays.stream(values).filter(v -> v != null && !v.isBlank()).findFirst().orElse("");
    }

    private static String sha256(byte[] body) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(body);
            StringBuilder builder = new StringBuilder();
            for (byte b : digest) builder.append(String.format("%02x", b));
            return builder.toString();
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    private record AvatarOperation(String fingerprint, CompletableFuture<Account> future) {
    }

    public record MediaRead(MediaAsset asset, StoredMediaObject object) {
    }
}
