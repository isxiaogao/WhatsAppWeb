package com.cloudwa.control.storage;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class MemoryMediaStorage implements MediaStorage {
    private final Map<String, StoredMediaObject> objects = new ConcurrentHashMap<>();

    @Override
    public String put(StoreMediaInput input) {
        String key = input.accountId() + "/" + input.id() + "-" + input.fileName().replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        objects.put(key, new StoredMediaObject(input.body(), (long) input.body().length, null, input.mimeType()));
        return key;
    }

    @Override
    public StoredMediaObject get(String storageKey, String range) {
        StoredMediaObject object = objects.get(storageKey);
        if (object == null) throw new IllegalArgumentException("媒体不存在");
        return object;
    }

    @Override
    public void delete(String storageKey) {
        objects.remove(storageKey);
    }
}
