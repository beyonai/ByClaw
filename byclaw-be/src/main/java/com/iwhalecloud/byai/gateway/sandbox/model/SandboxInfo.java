package com.iwhalecloud.byai.gateway.sandbox.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Date;
import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SandboxInfo {

    private String sandboxId;

    private String userCode;

    private String sandboxType;

    /**
     * All endpoints this sandbox exposes (one per port in spec.ports).
     */
    private List<String> endpoints;

    private Map<String, String> endpointHeaders;

    /**
     * Automatic expiration timeout in seconds.
     * Null means this sandbox was not created with OpenSandbox auto expiration.
     */
    private Integer timeoutSeconds;

    private Date remoteExpiresAt;

    private LocalDateTime createdTime;

    private LocalDateTime lastHeartbeatTime;
}
