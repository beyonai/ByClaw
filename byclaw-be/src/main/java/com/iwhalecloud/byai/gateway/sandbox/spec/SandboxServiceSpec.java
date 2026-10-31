package com.iwhalecloud.byai.gateway.sandbox.spec;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

/**
 * Sandbox service spec (stored as JSONB in DB).
 *
 * The spec is designed to drive the runtime creation of {@code CreateSandboxRequest}
 * without hardcoding a specific sandboxType in code.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class SandboxServiceSpec {

    /**
     * Base Worker AgentType advertised by this sandbox runtime. The user code is appended by the backend.
     * See {@code byclaw-be/src/main/java/com/iwhalecloud/byai/gateway/sandbox/README.md#worker-agent-type-configuration}.
     */
    public static final String WORKER_AGENT_TYPE_ENV = "BYAI_WORKER_AGENT_TYPE";

    /**
     * Container image (CreateSandboxRequest.image.uri).
     */
    private String image;

    /** Provider/lifecycle options retain the nested string-map wire format used by Platform. */
    private Map<String, Map<String, String>> runtimeOptions;

    /** Login participation is independent of enabled execution; absence preserves legacy startup.
     * Lifecycle options retain the existing nested string-map JSON contract.
     */
    @JsonIgnore
    public boolean isAutoStartEnabled() {
        Map<String, String> lifecycle = runtimeOptions == null ? null : runtimeOptions.get("lifecycle");
        String value = lifecycle == null ? null : lifecycle.get("autoStart");
        return value == null || Boolean.parseBoolean(value.trim());
    }

    /**
     * Startup instructions (CreateSandboxRequest.entrypoint).
     */
    private StartupSpec startup;

    /**
     * Ports to wait for. OpenSandbox will expose one endpoint per port.
     */
    private List<PortSpec> ports;

    /**
     * Primary service port exposed by the image.
     */
    private Integer servicePort;

    /**
     * Resource limits (CreateSandboxRequest.resourceLimits).
     */
    private Map<String, String> resourceLimits;

    /**
     * Resource requests (CreateSandboxRequest.resourceRequests).
     */
    private Map<String, String> resourceRequests;

    /**
     * Sandbox auto-expiration timeout in seconds.
     * Null means no automatic expiration.
     */
    private Integer timeout;

    /**
     * Container env defaults. Values may contain template placeholders.
     */
    private Map<String, String> env;

    /**
     * Mount volumes to container.
     */
    private List<VolumeSpec> volumes;

    /**
     * Optional bootstrap operations for preparing workspace/identity files.
     */
    private BootstrapSpec bootstrap;

    /**
     * template for openclaw.json
     */
    private String templateJson;

    /**
     * Resolved service type and profile. They are derived from DB metadata and not required in spec_json.
     */
    private String serviceType;

    /** Ownership boundary from sandbox_service_spec, not client-supplied spec JSON. */
    private String ownerScope;

    private String profileKey;
}
