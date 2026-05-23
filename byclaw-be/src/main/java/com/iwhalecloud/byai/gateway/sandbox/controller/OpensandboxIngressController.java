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
    private static final String NOVNC_INSTANCE = "novnc";
    private static final String OPEN_DESIGN_INSTANCE = "openDesign";
    private static final String FILEBROWSER_ROUTE_PREFIX = "/filebrowser";
    private static final String NOVNC_ROUTE_PREFIX = "/novnc";
    private static final String OPEN_DESIGN_ROUTE_PREFIX = "/openDesign";
    private static final String OPEN_SANDBOX_API_ROUTE_PREFIX = "/v1/sandboxes";

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
        proxy(FILEBROWSER_INSTANCE, FILEBROWSER_ROUTE_PREFIX, request, response);
    }

    @RequestMapping(path = {
        "/novnc",
        "/novnc/**"
    })
    public void proxyNovnc(HttpServletRequest request,
                           HttpServletResponse response) {
        proxy(NOVNC_INSTANCE, NOVNC_ROUTE_PREFIX, request, response);
    }

    @RequestMapping(path = {
        "/openDesign",
        "/openDesign/**"
    })
    public void proxyOpenDesign(HttpServletRequest request,
                                HttpServletResponse response) {
        proxy(OPEN_DESIGN_INSTANCE, OPEN_DESIGN_ROUTE_PREFIX, request, response);
    }

    @RequestMapping(path = {
        "/v1/sandboxes",
        "/v1/sandboxes/**"
    })
    public void proxyOpenSandboxApi(HttpServletRequest request,
                                    HttpServletResponse response) {
        String requestPath = extractOpenSandboxApiPath(request);
        log.debug("Direct OpenSandbox ingress request accepted: method={}, requestUri={}, requestPath={}, query={}",
            request.getMethod(), request.getRequestURI(), requestPath, request.getQueryString());
        sandboxIngressFacade.forwardOpenSandboxPath(requestPath, request, response);
    }

    private void proxy(String instance,
                       String routePrefix,
                       HttpServletRequest request,
                       HttpServletResponse response) {
        String requestPath = extractRequestPath(request, routePrefix);
        log.debug("Ingress request accepted: instance={}, method={}, requestUri={}, requestPath={}, query={}",
            instance, request.getMethod(), request.getRequestURI(), requestPath, request.getQueryString());
        sandboxIngressFacade.forward(instance, requestPath, request, response);
    }

    private String extractRequestPath(HttpServletRequest request, String routePrefix) {
        String requestUri = request.getRequestURI();
        if (requestUri == null || requestUri.isBlank()) {
            return "";
        }

        String path = stripContextPath(requestUri, request.getContextPath());
        if (routePrefix.equals(path)) {
            return "";
        }
        if (path.startsWith(routePrefix + "/")) {
            return path.substring(routePrefix.length());
        }
        return "";
    }

    private String extractOpenSandboxApiPath(HttpServletRequest request) {
        String requestUri = request.getRequestURI();
        if (requestUri == null || requestUri.isBlank()) {
            return OPEN_SANDBOX_API_ROUTE_PREFIX;
        }
        String path = stripContextPath(requestUri, request.getContextPath());
        if (OPEN_SANDBOX_API_ROUTE_PREFIX.equals(path)
            || path.startsWith(OPEN_SANDBOX_API_ROUTE_PREFIX + "/")) {
            return path;
        }
        return OPEN_SANDBOX_API_ROUTE_PREFIX;
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
