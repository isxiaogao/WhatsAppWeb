package com.cloudwa.control.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class DotenvLoaderTest {
  private static final String KEY = "DOTENV_LOADER_TEST_PORT";

  @TempDir
  Path tempDir;

  @AfterEach
  void clearProperty() {
    System.clearProperty(KEY);
  }

  @Test
  void loadsDotenvFromParentDirectoriesIntoSystemProperties() throws Exception {
    Files.writeString(tempDir.resolve(".env"), KEY + "=4410\n");
    Path nestedWorkingDirectory = Files.createDirectories(tempDir.resolve("apps/server"));

    DotenvLoader.loadIntoSystemProperties(nestedWorkingDirectory);

    assertThat(System.getProperty(KEY)).isEqualTo("4410");
  }

  @Test
  void keepsExistingSystemProperties() throws Exception {
    System.setProperty(KEY, "existing");
    Files.writeString(tempDir.resolve(".env"), KEY + "=4410\n");

    DotenvLoader.loadIntoSystemProperties(tempDir);

    assertThat(System.getProperty(KEY)).isEqualTo("existing");
  }
}
