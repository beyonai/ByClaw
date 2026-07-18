package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.net.URI;
import org.springframework.stereotype.Component;

/** Resolves recorder daemon URLs from the current user's named sandbox instance. */
@Component
public class RecorderSandboxEndpointResolver {

    private final SandboxIngressEndpointResolver endpointResolver;
    private final SandboxIngressRuntimeResolver runtimeResolver;

    public RecorderSandboxEndpointResolver(
        SandboxIngressEndpointResolver endpointResolver,
        SandboxIngressRuntimeResolver runtimeResolver
    ) {
        this.endpointResolver = endpointResolver;
        this.runtimeResolver = runtimeResolver;
    }

    public URI resolve(RecorderOwner owner, String instance, String path) {
        try {
            if (owner == null || owner.userCode() == null || owner.userCode().isBlank()) {
                throw new IllegalStateException("missing recorder owner");
            }
            String endpoint = endpointResolver.resolveRequiredEndpoint(owner.userCode(), instance);
            return runtimeResolver.resolve().buildTargetUrl(endpoint, path, null).uri();
        } catch (RecorderBrowserException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new RecorderBrowserException("daemon_unavailable", "user sandbox endpoint is unavailable");
        }
    }
}
