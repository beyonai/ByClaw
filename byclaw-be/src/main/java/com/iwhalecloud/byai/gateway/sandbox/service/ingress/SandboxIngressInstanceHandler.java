package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

public interface SandboxIngressInstanceHandler {

    boolean supports(SandboxIngressInstanceType instanceType);

    boolean isFallback();

    boolean requiresCurrentUserBinding();

    default String resolveTargetPath(String requestPath) {
        return requestPath;
    }

    default void beforeForward(SandboxIngressRequestContext requestContext) {
    }
}
