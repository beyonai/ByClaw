package com.iwhalecloud.byai.gateway.sandbox.controller;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.util.AntPathMatcher;

import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressFacade;

@RestController
public class OpensandboxIngressController {

    private static final Logger log = LoggerFactory.getLogger(OpensandboxIngressController.class);
    private static final AntPathMatcher PATH_MATCHER = new AntPathMatcher();
    private static final String FILEBROWSER_INSTANCE = "filebrowser";

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
        String pattern = (String) request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        String pathWithinMapping = (String) request.getAttribute(HandlerMapping.PATH_WITHIN_HANDLER_MAPPING_ATTRIBUTE);
        if (pattern == null || pathWithinMapping == null) {
            return "";
        }
        String extracted = PATH_MATCHER.extractPathWithinPattern(pattern, pathWithinMapping);
        if (extracted == null || extracted.isBlank()) {
            return "";
        }
        return extracted.startsWith("/") ? extracted : "/" + extracted;
    }
}
