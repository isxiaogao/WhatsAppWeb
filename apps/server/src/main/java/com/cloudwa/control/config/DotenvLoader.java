package com.cloudwa.control.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

public final class DotenvLoader {
    private DotenvLoader() {}

    public static void loadIntoSystemProperties(Path workingDirectory) {
        Path dotenv = findDotenv(workingDirectory.toAbsolutePath().normalize());
        if (dotenv == null) return;
        try {
            for (String line : Files.readAllLines(dotenv)) {
                loadLine(line);
            }
        } catch (IOException ignored) {
            // Spring's application.yaml defaults still allow local startup when .env cannot be read.
        }
    }

    private static Path findDotenv(Path start) {
        List<Path> candidates = List.of(
                start.resolve(".env"),
                start.resolve("..").resolve(".env").normalize(),
                start.resolve("..").resolve("..").resolve(".env").normalize()
        );
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) return candidate;
        }
        return null;
    }

    private static void loadLine(String rawLine) {
        String line = rawLine.trim();
        if (line.isEmpty() || line.startsWith("#")) return;
        int separator = line.indexOf('=');
        if (separator <= 0) return;
        String key = line.substring(0, separator).trim();
        String value = stripQuotes(line.substring(separator + 1).trim());
        if (key.isEmpty() || System.getenv().containsKey(key) || System.getProperty(key) != null) return;
        System.setProperty(key, value);
    }

    private static String stripQuotes(String value) {
        if (value.length() < 2) return value;
        char first = value.charAt(0);
        char last = value.charAt(value.length() - 1);
        if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }
}
