package com.cloudwa.control.storage;

public class MemoryStateStore implements StateStore {
    private ControlState state = new ControlState();

    @Override
    public synchronized ControlState load() {
        return state;
    }

    @Override
    public synchronized void save(ControlState state) {
        this.state = state;
    }
}
