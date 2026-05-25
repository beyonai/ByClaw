package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class FilebrowserSandboxIngressInstanceHandler implements SandboxIngressInstanceHandler {

    private static final Logger log = LoggerFactory.getLogger(FilebrowserSandboxIngressInstanceHandler.class);

    @Override
    public boolean supports(SandboxIngressInstanceType instanceType) {
        return SandboxIngressInstanceType.FILEBROWSER.equals(instanceType);
    }

    @Override
    public boolean isFallback() {
        return false;
    }

    @Override
    public boolean requiresCurrentUserBinding() {
        return true;
    }

    @Override
    public String resolveTargetPath(String requestPath) {
        String resolvedPath;
        if (requestPath == null || requestPath.isBlank()) {
            resolvedPath = "/filebrowser";
        }
        else if ("/".equals(requestPath)) {
            resolvedPath = "/filebrowser/";
        }
        else if (requestPath.startsWith("/filebrowser")) {
            resolvedPath = requestPath;
        }
        else {
            resolvedPath = "/filebrowser" + requestPath;
        }
        log.debug("Resolved filebrowser ingress target path: requestPath={}, resolvedPath={}", requestPath, resolvedPath);
        return resolvedPath;
    }

    @Override
    public void beforeForward(SandboxIngressRequestContext requestContext) {
        log.debug("Preparing filebrowser ingress forward: userCode={}, upstreamEndpoint={}, targetUrl={}",
            requestContext.userCode(), requestContext.upstreamEndpoint(), requestContext.targetUrl());
    }
}
