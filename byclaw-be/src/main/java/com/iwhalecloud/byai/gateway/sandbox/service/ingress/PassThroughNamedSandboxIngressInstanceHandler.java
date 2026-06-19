package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import java.util.EnumSet;
import java.util.Set;

import org.springframework.stereotype.Service;

@Service
public class PassThroughNamedSandboxIngressInstanceHandler implements SandboxIngressInstanceHandler {

    private static final Set<SandboxIngressInstanceType> SUPPORTED_TYPES = EnumSet.of(
        SandboxIngressInstanceType.NOVNC);

    @Override
    public boolean supports(SandboxIngressInstanceType instanceType) {
        return SUPPORTED_TYPES.contains(instanceType);
    }

    @Override
    public boolean isFallback() {
        return false;
    }

    @Override
    public boolean requiresCurrentUserBinding() {
        return false;
    }
}
