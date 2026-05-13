package com.iwhalecloud.byai.gateway.sandbox.client.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SandboxDetail {

    private String id;

    private ImageSpec image;

    private SandboxStatus status;

    private Map<String, String> metadata;

    private List<String> entrypoint;

    private OffsetDateTime expiresAt;

    private OffsetDateTime createdAt;
}
