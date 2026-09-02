package com.cloudwa.control.domain;

public record Conversation(
  String id,
  String accountId,
  String title,
  String subtitle,
  String lastMessagePreview,
  String lastMessageAt,
  int unreadCount,
  boolean isGroup,
  String avatarTone
) {}
