package com.cloudwa.control;

import com.cloudwa.control.domain.*;
import com.cloudwa.control.provider.*;
import com.cloudwa.control.storage.MemoryMediaStorage;
import com.cloudwa.control.storage.MemoryStateStore;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ControlCenterServiceTest {
  @Test
  void ignoresUnknownStatusOnlyProviderMessageWithoutCreatingConversation() {
    RecordingProvider provider = new RecordingProvider("provider-message-1");
    ControlCenterService service = new ControlCenterService(provider, new MemoryStateStore(), new MemoryMediaStorage(), ControlApiContractTest.testProperties());
    Account account = service.createAccount(new AccountCreateRequest("status-only"));
    service.connectAccount(account.id());

    provider.sink.onMessage(account.id(), new ProviderMessage(
      "unknown-message-id", "113426579877983@lid", MessageDirection.OUT,
      MessageKind.TEXT, "", null, Instant.now().toString(), MessageStatus.SENT));

    assertThat(service.listConversations(account.id())).isEmpty();
  }

  @Test
  void statusOnlyProviderMessageUpdatesExistingMessageWithoutCreatingLidConversation() {
    RecordingProvider provider = new RecordingProvider("provider-message-1");
    ControlCenterService service = new ControlCenterService(provider, new MemoryStateStore(), new MemoryMediaStorage(), ControlApiContractTest.testProperties());
    Account account = service.createAccount(new AccountCreateRequest("status update"));
    service.connectAccount(account.id());
    Conversation conversation = service.createConversation(account.id(), new ConversationCreateRequest("+8618180570807", null));
    service.sendMessage(account.id(), conversation.id(), new MessageCreateRequest("hello", "client-1"));

    provider.sink.onMessage(account.id(), new ProviderMessage(
      "provider-message-1", "113426579877983@lid", MessageDirection.OUT,
      MessageKind.TEXT, "", null, Instant.now().toString(), MessageStatus.DELIVERED));

    assertThat(service.listConversations(account.id()))
      .extracting(Conversation::id)
      .containsExactly("8618180570807@s.whatsapp.net");
    assertThat(service.listMessages(account.id(), conversation.id()))
      .extracting(Message::status)
      .containsExactly(MessageStatus.DELIVERED);
  }

  @Test
  void providerAvatarUrlUpdatesAccountWithoutLocalUpload() {
    RecordingProvider provider = new RecordingProvider("provider-message-1");
    ControlCenterService service = new ControlCenterService(provider, new MemoryStateStore(), new MemoryMediaStorage(), ControlApiContractTest.testProperties());
    Account account = service.createAccount(new AccountCreateRequest("avatar sync"));
    service.connectAccount(account.id());

    provider.sink.onAvatarUrl(account.id(), "https://pps.whatsapp.net/profile.jpg");

    assertThat(service.listAccounts())
      .filteredOn(item -> item.id().equals(account.id()))
      .singleElement()
      .satisfies(item -> {
        assertThat(item.avatarUrl()).isEqualTo("https://pps.whatsapp.net/profile.jpg");
        assertThat(item.avatarMediaId()).isNull();
      });
  }

  static class RecordingProvider implements WhatsAppProvider {
    private final String providerMessageId;
    ProviderSink sink;

    RecordingProvider(String providerMessageId) {
      this.providerMessageId = providerMessageId;
    }

    @Override public void connect(Account account, ProviderSink sink) {
      this.sink = sink;
      sink.onInstance(account.id(), "instance-" + account.id());
      sink.onStatus(account.id(), AccountStatus.ONLINE, null);
    }
    @Override public void disconnect(Account account) {}
    @Override public void deleteInstance(Account account) {}
    @Override public SendResult sendText(Account account, String conversationId, String text) {
      return new SendResult(providerMessageId);
    }
    @Override public SendResult sendMedia(Account account, String conversationId, SendMediaInput input) {
      return new SendResult(providerMessageId);
    }
    @Override public void updateProfilePicture(Account account, String pictureBase64) {}
    @Override public void removeProfilePicture(Account account) {}
    @Override public void handleWebhook(Account account, Map<String, Object> payload) {}
    @Override public ProviderHealth health() {
      return new ProviderHealth(true, "test", "test", null);
    }
  }
}
