package com.cloudwa.control.provider;

import com.cloudwa.control.domain.*;

public interface ProviderSink {
  void onStatus(String accountId, AccountStatus status, String error);
  void onQr(String accountId, String qrDataUrl);
  void onIdentity(String accountId, String phone);
  void onInstance(String accountId, String instanceId);
  void onConversation(String accountId, ProviderConversation conversation);
  void onMessage(String accountId, ProviderMessage message);
}
