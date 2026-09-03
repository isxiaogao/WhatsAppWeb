package com.cloudwa.control.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "wa-control")
public record WaControlProperties(
    State state,
    Evolution evolution,
    Media media,
    Logging logging
) {
    public record State(String path) {}

    public record Evolution(
            String apiUrl,
            String apiKey,
            String publicWebhookUrl,
            String webhookSecret,
            Duration pollInterval,
            Duration connectRetryMinDelay,
            boolean autoResume
    ) {}

    public record Media(S3 s3, Upload upload) {}

    public record S3(
            String endpoint,
            String region,
            String bucket,
            String accessKey,
            String secretKey
    ) {}

    public record Upload(long maxImageBytes, long maxVideoBytes, long maxAvatarBytes) {}

    public record Logging(RequestLog request) {}

    public record RequestLog(boolean enabled, boolean includeBody, int maxBodyLength) {}
}
