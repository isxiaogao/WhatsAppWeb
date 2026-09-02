package com.cloudwa.control.provider;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class EvolutionProviderTest {
  @Test
  void unwrapArrayAcceptsSingleWebhookObjectWithoutWrapperFields() throws Exception {
    Method method = EvolutionProvider.class.getDeclaredMethod("unwrapArray", Object.class);
    method.setAccessible(true);
    Map<String, Object> singleMessage = Map.of(
      "key", Map.of("remoteJid", "85261234567@s.whatsapp.net", "id", "message-id"),
      "message", Map.of("conversation", "hello")
    );

    Object result = assertDoesNotThrow(() -> method.invoke(null, singleMessage));

    assertEquals(1, ((java.util.List<?>) result).size());
  }

  @Test
  void normalizeMessageKeepsStatusOnlyMessageUpdatesByProviderKeyId() throws Exception {
    Method method = EvolutionProvider.class.getDeclaredMethod("normalizeMessage", Object.class, boolean.class);
    method.setAccessible(true);
    Map<String, Object> statusOnlyUpdate = Map.of(
      "keyId", "3EB0AF748ADA61DAA53697",
      "remoteJid", "113426579877983@lid",
      "fromMe", true,
      "status", "SERVER_ACK",
      "instanceId", "ea1274ae-be74-4bbc-8504-84b883b4f292",
      "messageId", "cmtjqhsxf0013lp8dtbwkrqau"
    );

    Object result = assertDoesNotThrow(() -> method.invoke(null, statusOnlyUpdate, true));

    assertNotNull(result);
    com.cloudwa.control.domain.ProviderMessage message = (com.cloudwa.control.domain.ProviderMessage) result;
    assertEquals("3EB0AF748ADA61DAA53697", message.providerMessageId());
    assertEquals("", message.body());
  }

  @Test
  void normalizeConversationIgnoresMetadataOnlyChatUpdates() throws Exception {
    Method method = EvolutionProvider.class.getDeclaredMethod("normalizeConversation", Object.class, boolean.class);
    method.setAccessible(true);
    Map<String, Object> metadataOnlyUpdate = Map.of(
      "remoteJid", "113426579877983@lid",
      "instanceId", "8d730d07-a410-4795-ae82-8cf996a8fd25"
    );

    Object result = assertDoesNotThrow(() -> method.invoke(null, metadataOnlyUpdate, true));

    assertEquals(null, result);
  }
}
