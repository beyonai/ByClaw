package com.iwhalecloud.byai.gateway.sandbox.controller;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressFacade;

@RestController
public class OpensandboxIngressController {

    private static final Logger log = LoggerFactory.getLogger(OpensandboxIngressController.class);
    private static final String FILEBROWSER_INSTANCE = "filebrowser";
    private static final String FILEBROWSER_ROUTE_PREFIX = "/filebrowser";

    private final SandboxIngressFacade sandboxIngressFacade;

    public OpensandboxIngressController(SandboxIngressFacade sandboxIngressFacade) {
        this.sandboxIngressFacade = sandboxIngressFacade;
    }

    @RequestMapping(path = {
        "/filebrowser",
        "/filebrowser/**"
    })
    public void proxyFilebrowser(HttpServletRequest request,
                                 HttpServletResponse response) {
        proxy(FILEBROWSER_INSTANCE, request, response);
    }

    private void proxy(String instance,
                       HttpServletRequest request,
                       HttpServletResponse response) {
        String requestPath = extractRequestPath(request);
        log.debug("Ingress request accepted: instance={}, method={}, requestUri={}, requestPath={}, query={}",
            instance, request.getMethod(), request.getRequestURI(), requestPath, request.getQueryString());
        sandboxIngressFacade.forward(instance, requestPath, request, response);
    }

    private String extractRequestPath(HttpServletRequest request) {
        String requestUri = request.getRequestURI();
        if (requestUri == null || requestUri.isBlank()) {
            return "";
        }

        String path = stripContextPath(requestUri, request.getContextPath());
        if (FILEBROWSER_ROUTE_PREFIX.equals(path)) {
            return "";
        }
        if (path.startsWith(FILEBROWSER_ROUTE_PREFIX + "/")) {
            return path.substring(FILEBROWSER_ROUTE_PREFIX.length());
        }
        return "";
    }

    private String stripContextPath(String requestUri, String contextPath) {
        if (contextPath == null || contextPath.isBlank() || "/".equals(contextPath)) {
            return requestUri;
        }
        if (requestUri.equals(contextPath)) {
            return "";
        }
        if (requestUri.startsWith(contextPath + "/")) {
            return requestUri.substring(contextPath.length());
        }
        return requestUri;
    }
}
