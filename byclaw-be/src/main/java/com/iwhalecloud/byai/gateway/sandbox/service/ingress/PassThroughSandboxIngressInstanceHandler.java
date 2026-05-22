package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import org.springframework.stereotype.Service;

@Service
public class PassThroughSandboxIngressInstanceHandler implements SandboxIngressInstanceHandler {

    @Override
    public boolean supports(SandboxIngressInstanceType instanceType) {
        return true;
    }

    @Override
    public boolean isFallback() {
        return true;
    }

    @Override
    public boolean requiresCurrentUserBinding() {
        return false;
    }
}
