package com.cloudwa.control.domain;

public record Account(
  String id,
  String name,
  String phone,
  AccountStatus status,
  String providerMode,
  String lastSeenAt,
  String qrDataUrl,
  String avatarUrl,
  String avatarMediaId,
  String error,
  EvolutionInstance evolution,
  String createdAt
) {}
