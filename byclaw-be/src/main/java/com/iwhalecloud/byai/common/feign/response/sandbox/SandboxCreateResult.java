package com.iwhalecloud.byai.common.feign.response.sandbox;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxStatus;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SandboxCreateResult {

    /** Legacy WhaleAgent endpoint field. OpenSandbox create response does not include this. */
    private String endpoint;

    /** Legacy WhaleAgent sandbox id field. Prefer {@link #id} for OpenSandbox-compatible payloads. */
    private String sandboxId;

    /** OpenSandbox-compatible unique sandbox identifier. */
    private String id;

    /** OpenSandbox-compatible lifecycle status. */
    private SandboxStatus status;

    /** OpenSandbox-compatible custom metadata from creation request. */
    private Map<String, String> metadata;

    /** OpenSandbox-compatible sandbox auto-termination time. */
    private OffsetDateTime expiresAt;

    /** OpenSandbox-compatible sandbox creation time. */
    private OffsetDateTime createdAt;

    /** OpenSandbox-compatible entry process specification. */
    private List<String> entrypoint;

    /** Optional extension for WhaleAgent responses that already include exposed endpoints. */
    private List<String> endpoints;

    public String resolveSandboxId() {
        return sandboxId != null && !sandboxId.isBlank() ? sandboxId : id;
    }
}
