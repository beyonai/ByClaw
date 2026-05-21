package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

/**
 * Runtime-specific sandbox operations. The standard lifecycle service owns
 * get-or-create, locking, caching and spec processing.
 */
public interface SandboxRuntimeProvider {

    String providerType();

    default Optional<SandboxRuntimeInstance> findReusable(String userCode, String sandboxType) {
        return Optional.empty();
    }

    SandboxRuntimeInstance create(CreateSandboxRequest request,
                                  SandboxServiceSpec spec,
                                  String userCode,
                                  String sandboxType,
                                  String idempotencyKey);

    default List<String> resolveEndpoints(SandboxRuntimeInstance instance,
                                          SandboxServiceSpec spec,
                                          CreateSandboxRequest request) {
        return instance != null && instance.getEndpoints() != null ? instance.getEndpoints() : Collections.emptyList();
    }

    default Map<String, String> resolveEndpointHeaders(SandboxRuntimeInstance instance) {
        return instance != null ? instance.getEndpointHeaders() : null;
    }

    void remove(String userCode, String sandboxType, SandboxInfo sandboxInfo);

    void heartbeat(String userCode, String sandboxType, SandboxInfo sandboxInfo);

    default Optional<SandboxRuntimeInstance> getSandbox(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        return Optional.empty();
    }

    default boolean exists(String userCode, String sandboxType, SandboxInfo sandboxInfo) {
        return getSandbox(userCode, sandboxType, sandboxInfo)
            .map(SandboxRuntimeInstance::getReusable)
            .orElse(Boolean.TRUE);
    }
}
