package com.cloudwa.control.domain;

public record ProviderMessage(
  String providerMessageId,
  String conversationId,
  MessageDirection direction,
  MessageKind kind,
  String body,
  ProviderMedia media,
  String createdAt,
  MessageStatus status
) {}
