package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class OpenDesignSandboxIngressInstanceHandler implements SandboxIngressInstanceHandler {

    private static final Logger log = LoggerFactory.getLogger(OpenDesignSandboxIngressInstanceHandler.class);
    private static final String OPEN_DESIGN_PREFIX = "/openDesign";

    @Override
    public boolean supports(SandboxIngressInstanceType instanceType) {
        return SandboxIngressInstanceType.OPENDESIGN.equals(instanceType);
    }

    @Override
    public boolean isFallback() {
        return false;
    }

    @Override
    public boolean requiresCurrentUserBinding() {
        return false;
    }

    @Override
    public String resolveTargetPath(String requestPath) {
        String resolvedPath;
        if (requestPath == null || requestPath.isBlank()) {
            resolvedPath = OPEN_DESIGN_PREFIX;
        }
        else if ("/".equals(requestPath)) {
            resolvedPath = OPEN_DESIGN_PREFIX + "/";
        }
        else if (requestPath.startsWith(OPEN_DESIGN_PREFIX)) {
            resolvedPath = requestPath;
        }
        else {
            resolvedPath = OPEN_DESIGN_PREFIX + requestPath;
        }
        log.debug("Resolved openDesign ingress target path: requestPath={}, resolvedPath={}", requestPath, resolvedPath);
        return resolvedPath;
    }
}
