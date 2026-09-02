package com.cloudwa.control.storage;

import com.cloudwa.control.domain.*;

import java.util.ArrayList;
import java.util.List;

public class ControlState {
    public List<Account> accounts = new ArrayList<>();
    public List<Conversation> conversations = new ArrayList<>();
    public List<Message> messages = new ArrayList<>();
    public List<MediaAsset> mediaAssets = new ArrayList<>();
}
