package com.cloudwa.control.domain;

public record MediaAsset(
  String id,
  String accountId,
  MediaKind kind,
  String storageKey,
  String mimeType,
  String fileName,
  long size,
  String createdAt
) {}
