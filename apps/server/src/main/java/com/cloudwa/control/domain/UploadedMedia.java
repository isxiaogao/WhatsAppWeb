package com.cloudwa.control.domain;

public record UploadedMedia(byte[] body, String fileName, String mimeType, long size, MediaKind kind) {}
