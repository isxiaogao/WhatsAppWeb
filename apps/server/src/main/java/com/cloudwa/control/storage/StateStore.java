package com.cloudwa.control.storage;

public interface StateStore {
  ControlState load();
  void save(ControlState state);
}
