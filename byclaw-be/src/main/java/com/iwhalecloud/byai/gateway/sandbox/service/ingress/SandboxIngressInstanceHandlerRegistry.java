package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import java.util.List;

import org.springframework.stereotype.Service;

@Service
public class SandboxIngressInstanceHandlerRegistry {

    private final List<SandboxIngressInstanceHandler> handlers;

    public SandboxIngressInstanceHandlerRegistry(List<SandboxIngressInstanceHandler> handlers) {
        this.handlers = handlers;
    }

    public SandboxIngressInstanceHandler resolve(SandboxIngressInstanceType instanceType) {
        return handlers.stream()
            .filter(handler -> !handler.isFallback())
            .filter(handler -> handler.supports(instanceType))
            .findFirst()
            .orElseGet(this::fallbackHandler);
    }

    private SandboxIngressInstanceHandler fallbackHandler() {
        return handlers.stream()
            .filter(SandboxIngressInstanceHandler::isFallback)
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("No fallback sandbox ingress handler found"));
    }
}
