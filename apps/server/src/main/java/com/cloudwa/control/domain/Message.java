package com.cloudwa.control.domain;

public record Message(
  String id,
  String providerMessageId,
  String clientRef,
  String accountId,
  String conversationId,
  MessageDirection direction,
  MessageKind kind,
  String body,
  MediaAttachment media,
  MessageStatus status,
  String createdAt
) {}
