package com.cloudwa.control.storage;

import com.cloudwa.control.config.WaControlProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.AccessDeniedException;
import java.util.UUID;

@Component
@Primary
public class JsonStateStore implements StateStore {
    private final ObjectMapper mapper;
    private final Path path;

    @Autowired
    public JsonStateStore(ObjectMapper mapper, WaControlProperties properties) {
        String configured = properties.state().path();
        this.mapper = mapper;
        this.path = Path.of(configured).toAbsolutePath();
    }

    JsonStateStore(ObjectMapper mapper, Path path) {
        this.mapper = mapper;
        this.path = path.toAbsolutePath();
    }

    @Override
    public synchronized ControlState load() {
        try {
            if (!Files.exists(path)) return new ControlState();
            ControlState state = mapper.readValue(path.toFile(), ControlState.class);
            return state == null ? new ControlState() : state;
        } catch (Exception error) {
            throw new IllegalStateException("控制状态读取失败: " + error.getMessage(), error);
        }
    }

    @Override
    public synchronized void save(ControlState state) {
        try {
            Files.createDirectories(path.getParent());
            Path tmp = path.resolveSibling(path.getFileName() + "." + UUID.randomUUID() + ".tmp");
            try {
                mapper.writerWithDefaultPrettyPrinter().writeValue(tmp.toFile(), state);
                replaceStateFile(tmp);
            } finally {
                Files.deleteIfExists(tmp);
            }
        } catch (Exception error) {
            throw new IllegalStateException("控制状态保存失败: " + error.getMessage(), error);
        }
    }

    private void replaceStateFile(Path tmp) throws java.io.IOException {
        try {
            Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AccessDeniedException | AtomicMoveNotSupportedException error) {
            Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
