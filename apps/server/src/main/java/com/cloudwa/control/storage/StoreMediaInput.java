package com.cloudwa.control.storage;

import com.cloudwa.control.domain.MediaKind;

public record StoreMediaInput(String id, String accountId, MediaKind kind, String fileName, String mimeType, byte[] body) {}
