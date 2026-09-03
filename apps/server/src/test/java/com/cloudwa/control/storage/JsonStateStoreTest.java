package com.cloudwa.control.storage;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.cloudwa.control.config.WaControlProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import java.nio.file.Path;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

class JsonStateStoreTest {
  @TempDir
  Path tempDir;

  @Test
  void saveCanReplaceAnExistingStateFileOnWindows() {
    Path stateFile = tempDir.resolve("control-center.json");
    JsonStateStore store = new JsonStateStore(new ObjectMapper(), stateFile);

    store.save(new ControlState());

    assertDoesNotThrow(() -> store.save(new ControlState()));
  }

  @Test
  void springCanCreateJsonStateStoreWithObjectMapperConstructor() {
    assertDoesNotThrow(() -> {
      try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
        context.registerBean(ObjectMapper.class);
        context.registerBean(WaControlProperties.class, () -> new WaControlProperties(
          new WaControlProperties.State(tempDir.resolve("control-center.json").toString()),
          new WaControlProperties.Evolution("http://127.0.0.1:8080", "key", "http://host.docker.internal:4100", "secret", Duration.ofSeconds(3), Duration.ofSeconds(15), true),
          new WaControlProperties.Media(
            new WaControlProperties.S3("http://127.0.0.1:9000", "us-east-1", "bucket", "access", "secret"),
            new WaControlProperties.Upload(10, 20, 5)
          ),
          new WaControlProperties.Logging(new WaControlProperties.RequestLog(false, true, 2048))
        ));
        context.register(JsonStateStore.class);
        context.refresh();
        context.getBean(JsonStateStore.class);
      }
    });
  }
}
