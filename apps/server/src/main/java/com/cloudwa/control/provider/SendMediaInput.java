package com.cloudwa.control.provider;

import com.cloudwa.control.domain.MediaKind;

public record SendMediaInput(MediaKind kind, String mimeType, String fileName, byte[] body, String caption) {}
