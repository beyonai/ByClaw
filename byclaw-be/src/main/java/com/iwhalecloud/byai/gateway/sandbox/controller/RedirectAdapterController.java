package com.iwhalecloud.byai.gateway.sandbox.controller;

import java.util.HashMap;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import com.iwhalecloud.byai.common.log.util.RequestContextUtil;
import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignRedirectResult;
import com.iwhalecloud.byai.gateway.sandbox.service.OpenDesignRedirectService;
import com.iwhalecloud.byai.gateway.sandbox.service.exception.OpenDesignAdapterException;

import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/redirectAdapter")
public class RedirectAdapterController {

    private final OpenDesignRedirectService openDesignRedirectService;

    public RedirectAdapterController(OpenDesignRedirectService openDesignRedirectService) {
        this.openDesignRedirectService = openDesignRedirectService;
    }

    @PatchMapping("")
    public ResponseEntity<?> test() {
        return ResponseEntity.ok("ok");
    }

    @GetMapping("/openDesignAdapter")
    public ResponseEntity<?> openDesignAdapterGet(@RequestParam Map<String, String> queryParams,
                                                  HttpServletRequest request) {
        return openDesignAdapterInternal(queryParams, null, request);
    }

    @PostMapping("/openDesignAdapter")
    public ResponseEntity<?> openDesignAdapterPost(@RequestParam Map<String, String> queryParams,
                                                   @RequestBody(required = false) Map<String, Object> bodyParams,
                                                   HttpServletRequest request) {
        return openDesignAdapterInternal(queryParams, bodyParams, request);
    }

    private ResponseEntity<?> openDesignAdapterInternal(Map<String, ?> queryParams, Map<String, Object> bodyParams,
                                                       HttpServletRequest request) {
        Map<String, Object> mergedParams = new HashMap<>();
        if (queryParams != null) {
            mergedParams.putAll(queryParams);
        }
        if (bodyParams != null) {
            mergedParams.putAll(bodyParams);
        }

        try {
            OpenDesignRedirectResult result = openDesignRedirectService.prepareRedirect(mergedParams);
            return ResponseEntity.status(302)
                .header("Location", withContextPath(result.getTargetUrl(), request))
                .build();
        } catch (OpenDesignAdapterException e) {
            return ResponseEntity.status(e.getStatusCode())
                .body(buildOpenDesignErrorBody(e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(500)
                .body(buildOpenDesignErrorBody(e.getMessage() != null ? e.getMessage() : "Open Design adapter failed"));
        }
    }

    private String withContextPath(String targetUrl, HttpServletRequest request) {
        if (targetUrl == null || !targetUrl.startsWith("/")) {
            return targetUrl;
        }
        String contextPath = request != null ? request.getContextPath() : null;
        if (contextPath == null || contextPath.isBlank() || "/".equals(contextPath)) {
            return targetUrl;
        }
        if (targetUrl.equals(contextPath) || targetUrl.startsWith(contextPath + "/")) {
            return targetUrl;
        }
        return contextPath + targetUrl;
    }

    private Map<String, Object> buildOpenDesignErrorBody(String message) {
        Map<String, Object> body = new HashMap<>();
        body.put("error", message);
        body.put("requestId", String.valueOf(RequestContextUtil.getRequestIdOrGenerate()));
        return body;
    }
}
