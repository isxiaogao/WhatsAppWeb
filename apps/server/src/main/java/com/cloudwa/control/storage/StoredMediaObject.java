package com.cloudwa.control.storage;

public record StoredMediaObject(byte[] body, Long contentLength, String contentRange, String contentType) {}
