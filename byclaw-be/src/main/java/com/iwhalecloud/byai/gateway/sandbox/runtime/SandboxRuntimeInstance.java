package com.iwhalecloud.byai.gateway.sandbox.runtime;

import java.util.List;
import java.util.Map;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Provider-neutral sandbox instance returned by a concrete runtime.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SandboxRuntimeInstance {

    private String sandboxId;

    private List<String> endpoints;

    private Map<String, String> endpointHeaders;
}
