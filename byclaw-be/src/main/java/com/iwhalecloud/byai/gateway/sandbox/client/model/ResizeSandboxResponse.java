package com.iwhalecloud.byai.gateway.sandbox.client.model;

import java.util.Map;

import lombok.Data;

@Data
public class ResizeSandboxResponse {

    private String requestId;

    private String operationId;

    private String sandboxId;

    private String state;

    private String message;

    private Map<String, String> metadata;
}
