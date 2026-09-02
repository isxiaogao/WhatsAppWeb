package com.cloudwa.control.domain;

public record ProviderMedia(MediaKind kind, String mimeType, String fileName, long size, String base64) {}
