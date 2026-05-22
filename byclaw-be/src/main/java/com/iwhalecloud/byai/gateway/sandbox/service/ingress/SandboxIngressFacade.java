package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

@Service
public class SandboxIngressFacade {

    private static final Logger log = LoggerFactory.getLogger(SandboxIngressFacade.class);

    private final SandboxIngressRequestContextResolver requestContextResolver;
    private final SandboxIngressInstanceHandlerRegistry instanceHandlerRegistry;
    private final SandboxIngressRuntimeResolver runtimeResolver;
    private final SandboxIngressTransportService transportService;

    public SandboxIngressFacade(SandboxIngressRequestContextResolver requestContextResolver,
                                SandboxIngressInstanceHandlerRegistry instanceHandlerRegistry,
                                SandboxIngressRuntimeResolver runtimeResolver,
                                SandboxIngressTransportService transportService) {
        this.requestContextResolver = requestContextResolver;
        this.instanceHandlerRegistry = instanceHandlerRegistry;
        this.runtimeResolver = runtimeResolver;
        this.transportService = transportService;
    }

    public void forward(String instance,
                        String requestPath,
                        HttpServletRequest request,
                        HttpServletResponse response) {
        log.debug("Start ingress forward: instance={}, method={}, requestUri={}, requestPath={}",
            instance, request.getMethod(), request.getRequestURI(), requestPath);
        SandboxIngressRequestContext requestContext = requestContextResolver.resolve(request, instance, requestPath);
        log.debug("Ingress context resolved: instance={}, instanceType={}, userCode={}, upstreamEndpoint={}, targetUrl={}",
            requestContext.instance(), requestContext.instanceType(), requestContext.userCode(),
            requestContext.upstreamEndpoint(), requestContext.targetUrl());
        SandboxIngressInstanceHandler handler = instanceHandlerRegistry.resolve(requestContext.instanceType());
        String targetPath = handler.resolveTargetPath(requestContext.requestPath());
        if (!java.util.Objects.equals(targetPath, requestContext.requestPath())) {
            log.debug("Ingress target path rewritten: instance={}, originalPath={}, rewrittenPath={}",
                requestContext.instance(), requestContext.requestPath(), targetPath);
            requestContext = new SandboxIngressRequestContext(requestContext.instanceType(), requestContext.instance(),
                requestContext.userCode(), requestContext.upstreamEndpoint(), requestContext.requestMethod(), targetPath,
                requestContext.queryString(),
                runtimeResolver.resolve().buildTargetUrl(requestContext.upstreamEndpoint(), targetPath,
                    requestContext.queryString()),
                requestContext.beyondToken(), requestContext.loginInfo(), requestContext.extraHeaders());
        }
        var previousLoginInfo = CurrentUserHolder.getLoginInfo();
        boolean bindCurrentUser = handler.requiresCurrentUserBinding() && requestContext.loginInfo() != null;
        if (bindCurrentUser) {
            log.debug("Binding current user for ingress request: instance={}, userCode={}",
                requestContext.instance(), requestContext.userCode());
            CurrentUserHolder.setLoginInfo(requestContext.loginInfo());
        }
        try {
            handler.beforeForward(requestContext);
            transportService.forward(request, response, requestContext);
            log.debug("Ingress forward completed: instance={}, userCode={}, targetUrl={}, responseStatus={}",
                requestContext.instance(), requestContext.userCode(), requestContext.targetUrl(), response.getStatus());
        }
        finally {
            if (bindCurrentUser) {
                if (previousLoginInfo != null) {
                    CurrentUserHolder.setLoginInfo(previousLoginInfo);
                }
                else {
                    CurrentUserHolder.clearLoginInfo();
                }
            }
        }
    }
}
