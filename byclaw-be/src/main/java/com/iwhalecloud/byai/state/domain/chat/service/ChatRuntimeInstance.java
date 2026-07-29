package com.iwhalecloud.byai.state.domain.chat.service;

import java.net.InetAddress;
import java.util.UUID;

import org.springframework.stereotype.Component;

@Component
public class ChatRuntimeInstance {

    private final String instanceId = buildInstanceId();

    public String getInstanceId() {
        return instanceId;
    }

    private String buildInstanceId() {
        try {
            return InetAddress.getLocalHost().getHostName() + ":" + UUID.randomUUID();
        }
        catch (Exception e) {
            return UUID.randomUUID().toString();
        }
    }
}
