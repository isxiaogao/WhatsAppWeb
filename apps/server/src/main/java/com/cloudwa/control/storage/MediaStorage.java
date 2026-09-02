package com.cloudwa.control.storage;

public interface MediaStorage {
    String put(StoreMediaInput input);

    StoredMediaObject get(String storageKey, String range);

    void delete(String storageKey);
}
