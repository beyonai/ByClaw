package com.iwhalecloud.byai.gateway.sandbox.spec;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.List;
import java.util.Map;

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
     * Container image (CreateSandboxRequest.image.uri).
     */
    private String image;

    /**
     * Startup instructions (CreateSandboxRequest.entrypoint).
     */
    private StartupSpec startup;

    /**
     * Ports to wait for. OpenSandbox will expose one endpoint per port.
     */
    private List<PortSpec> ports;

    /**
     * Resource limits (CreateSandboxRequest.resourceLimits).
     */
    private Map<String, String> resourceLimits;

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
}
