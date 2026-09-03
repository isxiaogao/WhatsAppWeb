package com.cloudwa.control.domain;

public record MediaAttachment(
  String id,
  MediaKind kind,
  String url,
  String mimeType,
  String fileName,
  long size
) {}
