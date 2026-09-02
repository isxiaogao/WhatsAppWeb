package com.cloudwa.control;

import com.cloudwa.control.config.WaControlProperties;
import com.cloudwa.control.domain.*;
import com.cloudwa.control.provider.*;
import com.cloudwa.control.storage.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ControlApiController.class)
@Import({ControlCenterService.class, ControlApiContractTest.TestConfig.class})
class ControlApiContractTest {
  private final MockMvc mvc;
  private final TestProvider provider;
  private final ControlCenterService service;

  @Autowired
  ControlApiContractTest(MockMvc mvc, WhatsAppProvider provider, ControlCenterService service) {
    this.mvc = mvc;
    this.provider = (TestProvider) provider;
    this.service = service;
  }

  @Test
  void keepsExistingRestContractForAccountsMessagesMediaWebhookAndState() throws Exception {
    String created = mvc.perform(post("/api/accounts")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"香港实际账号\"}"))
      .andExpect(status().isCreated())
      .andExpect(jsonPath("$.providerMode").value("evolution"))
      .andExpect(jsonPath("$.evolution.instanceName", matchesPattern("^wa_[a-f0-9]{32}$")))
      .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    String accountId = TestJson.read(created, "id");

    mvc.perform(post("/api/accounts/" + accountId + "/connect"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.status").value("ONLINE"))
      .andExpect(jsonPath("$.phone").value("+85261234567"));

    String chat = mvc.perform(post("/api/accounts/" + accountId + "/conversations")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"target\":\"+852 6123 4567\",\"name\":\"Test Contact\"}"))
      .andExpect(status().isCreated())
      .andExpect(jsonPath("$.id").value("85261234567@s.whatsapp.net"))
      .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    String conversationId = TestJson.read(chat, "id");

    mvc.perform(post("/api/accounts/" + accountId + "/conversations/" + conversationId + "/messages")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"text\":\"Actual provider contract message\",\"clientRef\":\"test-real-1\"}"))
      .andExpect(status().isCreated())
      .andExpect(jsonPath("$.status").value("SENT"))
      .andExpect(jsonPath("$.providerMessageId", startsWith("provider_")));

    MockMultipartFile file = new MockMultipartFile("file", "proof.png", "image/png", samplePng());
    String media = mvc.perform(multipart("/api/accounts/" + accountId + "/conversations/" + conversationId + "/media")
        .file(file)
        .param("caption", "真实媒体契约图片")
        .param("clientRef", "test-media-1"))
      .andExpect(status().isCreated())
      .andExpect(jsonPath("$.kind").value("IMAGE"))
      .andExpect(jsonPath("$.status").value("SENT"))
      .andExpect(jsonPath("$.media.url", startsWith("/api/media/")))
      .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    assertEquals("IMAGE", provider.lastMedia.kind().name());

    mvc.perform(get(TestJson.read(media, "media.url")))
      .andExpect(status().isOk())
      .andExpect(content().contentType("image/png"));

    mvc.perform(multipart("/api/accounts/" + accountId + "/avatar").file(file).with(request -> {
      request.setMethod("PUT");
      return request;
    }))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.avatarUrl", startsWith("/api/media/")));
    assertEquals(Base64.getEncoder().encodeToString(samplePng()), provider.avatarBase64);

    mvc.perform(delete("/api/accounts/" + accountId + "/avatar"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.avatarUrl").doesNotExist());

    mvc.perform(post("/api/webhooks/evolution/" + accountId)
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"text\":\"should be rejected\"}"))
      .andExpect(status().isUnauthorized());

    mvc.perform(post("/api/webhooks/evolution/" + accountId)
        .header("x-control-webhook-secret", "local-mvp-webhook-secret")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"text\":\"真实入站 Webhook\"}"))
      .andExpect(status().isNoContent());

    mvc.perform(get("/api/accounts/" + accountId + "/conversations/" + conversationId + "/messages"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.items", hasSize(3)));
  }

  @Test
  void duplicateConcurrentAvatarUploadsShareProviderOperation() throws Exception {
    provider.avatarUpdateCalls.set(0);
    Account account = service.createAccount(new AccountCreateRequest("Avatar idempotency test"));
    service.connectAccount(account.id());
    UploadedMedia input = new UploadedMedia(samplePng(), "same-avatar.png", "image/png", samplePng().length, MediaKind.IMAGE);
    CompletableFuture.allOf(
      CompletableFuture.supplyAsync(() -> service.updateAccountAvatar(account.id(), input)),
      CompletableFuture.supplyAsync(() -> service.updateAccountAvatar(account.id(), input))
    ).join();
    assertEquals(1, provider.avatarUpdateCalls.get());
  }

  @Test
  void acceptsWebhookWhenUrlAccountIsStaleButPayloadMatchesKnownEvolutionInstance() throws Exception {
    Account account = service.createAccount(new AccountCreateRequest("Webhook stale route test"));
    Account connected = service.connectAccount(account.id());

    mvc.perform(post("/api/webhooks/evolution/stale-account-id")
        .header("x-control-webhook-secret", "local-mvp-webhook-secret")
        .contentType(MediaType.APPLICATION_JSON)
        .content("{\"instanceId\":\"" + connected.evolution().instanceId() + "\",\"text\":\"来自旧 webhook URL 的消息\"}"))
      .andExpect(status().isNoContent());

    mvc.perform(get("/api/accounts/" + account.id() + "/conversations/85261234567@s.whatsapp.net/messages"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.items", hasSize(1)))
      .andExpect(jsonPath("$.items[0].accountId").value(account.id()));
  }

  private static byte[] samplePng() {
    return Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=");
  }

  static class TestConfig {
    @Bean MemoryStateStore stateStore() { return new MemoryStateStore(); }
    @Bean MemoryMediaStorage mediaStorage() { return new MemoryMediaStorage(); }
    @Bean TestProvider whatsappProvider() { return new TestProvider(); }
    @Bean WaControlProperties waControlProperties() { return testProperties(); }
  }

  static WaControlProperties testProperties() {
    return new WaControlProperties(
      new WaControlProperties.State("runtime/control-center.json"),
      new WaControlProperties.Evolution("http://127.0.0.1:8080", "local-mvp-evolution-key", "http://host.docker.internal:4100", "local-mvp-webhook-secret", Duration.ofSeconds(3), Duration.ofSeconds(15), true),
      new WaControlProperties.Media(
        new WaControlProperties.S3("http://127.0.0.1:9000", "us-east-1", "wa-control-media", "wa-control-media", "local-mvp-media-secret"),
        new WaControlProperties.Upload(10 * 1024 * 1024, 64 * 1024 * 1024, 5 * 1024 * 1024)
      ),
      new WaControlProperties.Logging(new WaControlProperties.RequestLog(false, true, 2048))
    );
  }

  static class TestProvider implements WhatsAppProvider {
    ProviderSink sink;
    SendMediaInput lastMedia;
    String avatarBase64;
    AtomicInteger avatarUpdateCalls = new AtomicInteger();

    @Override public void connect(Account account, ProviderSink sink) {
      this.sink = sink;
      sink.onInstance(account.id(), "evolution-instance-id-" + account.id());
      sink.onIdentity(account.id(), "+85261234567");
      sink.onStatus(account.id(), AccountStatus.ONLINE, null);
    }
    @Override public void disconnect(Account account) {}
    @Override public void deleteInstance(Account account) {}
    @Override public SendResult sendText(Account account, String conversationId, String text) {
      return new SendResult("provider_" + account.id());
    }
    @Override public SendResult sendMedia(Account account, String conversationId, SendMediaInput input) {
      lastMedia = input;
      return new SendResult("provider_media_" + account.id());
    }
    @Override public void updateProfilePicture(Account account, String pictureBase64) {
      avatarUpdateCalls.incrementAndGet();
      try { Thread.sleep(25); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
      avatarBase64 = pictureBase64;
    }
    @Override public void removeProfilePicture(Account account) { avatarBase64 = null; }
    @Override public void handleWebhook(Account account, Map<String, Object> payload) {
      sink.onMessage(account.id(), new ProviderMessage(
        "incoming-provider-id", "85261234567@s.whatsapp.net", MessageDirection.IN,
        MessageKind.TEXT, String.valueOf(payload.getOrDefault("text", "")), null,
        java.time.Instant.now().toString(), MessageStatus.RECEIVED));
    }
    @Override public ProviderHealth health() {
      return new ProviderHealth(true, "http://evolution.test", "2.3.7", null);
    }
  }

  static class TestJson {
    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();
    static String read(String json, String path) throws Exception {
      com.fasterxml.jackson.databind.JsonNode node = MAPPER.readTree(json);
      for (String part : path.split("\\.")) node = node.get(part);
      return node.asText();
    }
  }
}
