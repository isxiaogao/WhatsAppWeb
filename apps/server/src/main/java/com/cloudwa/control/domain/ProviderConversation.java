package com.cloudwa.control.domain;

public record ProviderConversation(
  String id,
  String title,
  String subtitle,
  String lastMessagePreview,
  String lastMessageAt,
  Integer unreadCount,
  Boolean isGroup
) {}
