package com.cloudwa.control.provider;

import com.cloudwa.control.config.WaControlProperties;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriUtils;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@Component
public class EvolutionClient {
    public final String baseUrl;
    private final String apiKey;
    private final RestClient restClient;
    private final ObjectMapper mapper;

    public EvolutionClient(ObjectMapper mapper, WaControlProperties properties) {
        this.mapper = mapper;
        this.baseUrl = properties.evolution().apiUrl().replaceAll("/$", "");
        this.apiKey = properties.evolution().apiKey();
        this.restClient = RestClient.builder().baseUrl(baseUrl).defaultHeader("apikey", apiKey).defaultHeader("Accept", "application/json").build();
    }

    public Object health() {
        return request("GET", "/", null);
    }

    public Object fetchInstances() {
        return request("GET", "/instance/fetchInstances", null);
    }

    public Object createInstance(String instanceName) {
        return request("POST", "/instance/create", Map.of("instanceName", instanceName, "integration", "WHATSAPP-BAILEYS", "qrcode", true));
    }

    public Object connectInstance(String instanceName) {
        return request("GET", "/instance/connect/" + enc(instanceName), null);
    }

    public Object connectionState(String instanceName) {
        return request("GET", "/instance/connectionState/" + enc(instanceName), null);
    }

    public Object logoutInstance(String instanceName) {
        return request("DELETE", "/instance/logout/" + enc(instanceName), null);
    }

    public Object deleteInstance(String instanceName) {
        return request("DELETE", "/instance/delete/" + enc(instanceName), null);
    }

    public Object findChats(String instanceName) {
        return request("POST", "/chat/findChats/" + enc(instanceName), Map.of("where", Map.of(), "take", 50, "skip", 0, "orderBy", Map.of("updatedAt", "desc")));
    }

    public Object findMessages(String instanceName, String remoteJid) {
        return request("POST", "/chat/findMessages/" + enc(instanceName), Map.of("where", Map.of("key", Map.of("remoteJid", remoteJid)), "take", 50, "skip", 0, "orderBy", Map.of("messageTimestamp", "desc")));
    }

    public Object getBase64FromMediaMessage(String instanceName, Object message) {
        return request("POST", "/chat/getBase64FromMediaMessage/" + enc(instanceName), Map.of("message", message));
    }

    public Object fetchProfilePictureUrl(String instanceName, String number) {
        return request("POST", "/chat/fetchProfilePictureUrl/" + enc(instanceName), Map.of("number", number));
    }

    public Object setWebhook(String instanceName, String url, String secret) {
        return request("POST", "/webhook/set/" + enc(instanceName), Map.of("webhook", Map.of(
                "enabled", true, "url", url,
                "events", List.of("QRCODE_UPDATED", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE", "CONNECTION_UPDATE", "CHATS_UPSERT", "CHATS_UPDATE"),
                "headers", Map.of("x-control-webhook-secret", secret), "base64", false)));
    }

    public Object sendText(String instanceName, String number, String text) {
        try {
            return request("POST", "/message/sendText/" + enc(instanceName), Map.of("number", number, "text", text, "delay", 400, "linkPreview", true));
        } catch (EvolutionApiException error) {
            if (error.status != 400) throw error;
            return request("POST", "/message/sendText/" + enc(instanceName), Map.of("number", number, "textMessage", Map.of("text", text), "delay", 400, "linkPreview", true));
        }
    }

    public Object sendMedia(String instanceName, String number, String mediaType, String mimeType, byte[] body, String caption, String fileName) {
        LinkedMultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("number", number);
        form.add("mediatype", mediaType);
        form.add("mimetype", mimeType);
        form.add("caption", caption);
        form.add("fileName", fileName);
        form.add("filename", fileName);
        form.add("file", new NamedByteArrayResource(body, fileName));
        return restClient.post().uri("/message/sendMedia/" + enc(instanceName)).contentType(MediaType.MULTIPART_FORM_DATA).body(form).retrieve().body(Object.class);
    }

    public Object updateProfilePicture(String instanceName, String picture) {
        return request("POST", "/chat/updateProfilePicture/" + enc(instanceName), Map.of("picture", picture));
    }

    public Object removeProfilePicture(String instanceName) {
        return request("DELETE", "/chat/removeProfilePicture/" + enc(instanceName), null);
    }

    private Object request(String method, String path, Object body) {
        try {
            RestClient.RequestBodySpec spec = restClient.method(HttpMethod.valueOf(method)).uri(path).contentType(MediaType.APPLICATION_JSON);
            String raw = body == null ? spec.retrieve().body(String.class) : spec.body(body).retrieve().body(String.class);
            if (raw == null || raw.isBlank()) return null;
            return mapper.readValue(raw, new TypeReference<Object>() {
            });
        } catch (org.springframework.web.client.HttpStatusCodeException error) {
            throw new EvolutionApiException("Evolution API " + error.getStatusCode().value() + ": " + error.getResponseBodyAsString(), error.getStatusCode().value());
        } catch (EvolutionApiException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("无法连接 Evolution API (" + baseUrl + "): " + error.getMessage(), error);
        }
    }

    private static String enc(String value) {
        return UriUtils.encodePathSegment(value, StandardCharsets.UTF_8);
    }

    static class EvolutionApiException extends RuntimeException {
        final int status;

        EvolutionApiException(String message, int status) {
            super(message);
            this.status = status;
        }
    }

    static class NamedByteArrayResource extends ByteArrayResource {
        private final String filename;

        NamedByteArrayResource(byte[] byteArray, String filename) {
            super(byteArray);
            this.filename = filename;
        }

        @Override
        public String getFilename() {
            return filename;
        }
    }
}
