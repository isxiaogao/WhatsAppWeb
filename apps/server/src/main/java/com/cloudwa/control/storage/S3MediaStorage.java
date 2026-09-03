package com.cloudwa.control.storage;

import com.cloudwa.control.config.WaControlProperties;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.net.URI;

@Component
@Primary
public class S3MediaStorage implements MediaStorage {
    private final String bucket;
    private final S3Client client;
    private volatile boolean ready;

    public S3MediaStorage(WaControlProperties properties) {
        WaControlProperties.S3 s3 = properties.media().s3();
        this.bucket = s3.bucket();
        client = S3Client.builder()
                .endpointOverride(URI.create(s3.endpoint()))
                .region(Region.of(s3.region()))
                .forcePathStyle(true)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(
                        s3.accessKey(),
                        s3.secretKey())))
                .build();
    }

    @Override
    public String put(StoreMediaInput input) {
        ensureBucket();
        String key = input.accountId().replaceAll("[^a-zA-Z0-9_-]", "") + "/" + input.kind().name().toLowerCase()
                + "/" + input.id() + "-" + safeFileName(input.fileName());
        client.putObject(PutObjectRequest.builder()
                .bucket(bucket).key(key).contentType(input.mimeType())
                .contentDisposition("inline; filename=\"" + asciiFileName(input.fileName()) + "\"")
                .contentLength((long) input.body().length).build(), RequestBody.fromBytes(input.body()));
        return key;
    }

    @Override
    public StoredMediaObject get(String storageKey, String range) {
        ensureBucket();
        GetObjectRequest.Builder request = GetObjectRequest.builder().bucket(bucket).key(storageKey);
        if (range != null && !range.isBlank()) request.range(range);
        ResponseBytes<GetObjectResponse> response = client.getObjectAsBytes(request.build());
        return new StoredMediaObject(response.asByteArray(), response.response().contentLength(),
                response.response().contentRange(), response.response().contentType());
    }

    @Override
    public void delete(String storageKey) {
        ensureBucket();
        client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(storageKey).build());
    }

    private synchronized void ensureBucket() {
        if (ready) return;
        try {
            client.headBucket(HeadBucketRequest.builder().bucket(bucket).build());
        } catch (S3Exception error) {
            if (error.statusCode() != 404) throw error;
            client.createBucket(CreateBucketRequest.builder().bucket(bucket).build());
        }
        ready = true;
    }

    private static String safeFileName(String value) {
        String normalized = value == null ? "media" : value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (normalized.isBlank()) return "media";
        return normalized.length() > 120 ? normalized.substring(normalized.length() - 120) : normalized;
    }

    private static String asciiFileName(String value) {
        String ascii = safeFileName(value).replaceAll("[^a-zA-Z0-9._-]", "_");
        return ascii.isBlank() ? "media" : ascii;
    }

}
