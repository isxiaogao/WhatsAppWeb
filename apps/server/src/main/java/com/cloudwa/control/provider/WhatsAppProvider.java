package com.cloudwa.control.provider;

import com.cloudwa.control.domain.Account;

import java.util.Map;

public interface WhatsAppProvider {
  void connect(Account account, ProviderSink sink);
  void disconnect(Account account);
  void deleteInstance(Account account);
  SendResult sendText(Account account, String conversationId, String text);
  SendResult sendMedia(Account account, String conversationId, SendMediaInput input);
  void updateProfilePicture(Account account, String pictureBase64);
  void removeProfilePicture(Account account);
  void handleWebhook(Account account, Map<String, Object> payload);
  ProviderHealth health();
}
