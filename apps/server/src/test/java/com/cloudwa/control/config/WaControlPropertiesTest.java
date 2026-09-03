package com.cloudwa.control.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class WaControlPropertiesTest {
  private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
    .withUserConfiguration(TestConfig.class)
    .withPropertyValues(
      "wa-control.state.path=runtime/test-state.json",
      "wa-control.evolution.api-url=http://127.0.0.1:18080",
      "wa-control.evolution.api-key=test-key",
      "wa-control.evolution.public-webhook-url=http://host.docker.internal:14100",
      "wa-control.evolution.webhook-secret=test-secret",
      "wa-control.evolution.poll-interval=2s",
      "wa-control.evolution.connect-retry-min-delay=9s",
      "wa-control.media.s3.endpoint=http://127.0.0.1:19000",
      "wa-control.media.s3.region=ap-east-1",
      "wa-control.media.s3.bucket=test-bucket",
      "wa-control.media.upload.max-image-bytes=1048576",
      "wa-control.logging.request.include-body=true",
      "wa-control.logging.request.max-body-length=256"
    );

  @Test
  void bindsApplicationYamlValuesIntoTypedProperties() {
    contextRunner.run(context -> {
      WaControlProperties properties = context.getBean(WaControlProperties.class);

      assertThat(properties.state().path()).isEqualTo("runtime/test-state.json");
      assertThat(properties.evolution().apiUrl()).isEqualTo("http://127.0.0.1:18080");
      assertThat(properties.evolution().apiKey()).isEqualTo("test-key");
      assertThat(properties.evolution().publicWebhookUrl()).isEqualTo("http://host.docker.internal:14100");
      assertThat(properties.evolution().webhookSecret()).isEqualTo("test-secret");
      assertThat(properties.evolution().pollInterval()).isEqualTo(Duration.ofSeconds(2));
      assertThat(properties.evolution().connectRetryMinDelay()).isEqualTo(Duration.ofSeconds(9));
      assertThat(properties.media().s3().endpoint()).isEqualTo("http://127.0.0.1:19000");
      assertThat(properties.media().s3().region()).isEqualTo("ap-east-1");
      assertThat(properties.media().s3().bucket()).isEqualTo("test-bucket");
      assertThat(properties.media().upload().maxImageBytes()).isEqualTo(1_048_576L);
      assertThat(properties.logging().request().includeBody()).isTrue();
      assertThat(properties.logging().request().maxBodyLength()).isEqualTo(256);
    });
  }

  @Configuration
  @EnableConfigurationProperties(WaControlProperties.class)
  static class TestConfig {}
}
