package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class SandboxIngressRuntimeResolver {

    private final List<SandboxIngressRuntimeSupport> runtimeSupports;
    private final String storageType;

    public SandboxIngressRuntimeResolver(List<SandboxIngressRuntimeSupport> runtimeSupports,
                                         @Value("${file.storage.type:minio}") String storageType) {
        this.runtimeSupports = runtimeSupports;
        this.storageType = storageType;
    }

    public SandboxIngressRuntimeSupport resolve() {
        return runtimeSupports.stream()
            .filter(support -> support.supports(storageType))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("No sandbox ingress runtime support found"));
    }
}
