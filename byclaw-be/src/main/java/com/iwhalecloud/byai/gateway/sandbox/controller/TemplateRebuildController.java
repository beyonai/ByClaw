package com.iwhalecloud.byai.gateway.sandbox.controller;

import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Operator metadata is exclusively taken from the authenticated login, never from request fields. */
@RestController
@RequestMapping("/sandbox/templateRebuild")
public class TemplateRebuildController {
    private final PlatformRemoteGateway remote;
    public TemplateRebuildController(PlatformRemoteGateway remote) { this.remote = remote; }

    @PostMapping("/capabilities")
    public ResponseUtil capabilities() {
        if (!remote.isRemote()) return ResponseUtil.successResponse(Collections.singletonMap("supported", false));
        return remote.controller("templateRebuild/capabilities", Collections.emptyMap());
    }

    @PostMapping("/start")
    public ResponseUtil start(@RequestBody Map<String, Object> request) {
        requireManager();
        if (!remote.isRemote()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Template rebuild requires managed MicroVM Platform");
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("serviceKey", request.get("serviceKey"));
        params.put("requestId", request.get("requestId"));
        params.put("actorCode", CurrentUserHolder.getCurrentUserCode());
        String name = CurrentUserHolder.getCurrentUserName();
        params.put("actorName", name == null || name.isBlank() ? CurrentUserHolder.getCurrentUserCode() : name);
        return remote.controller("templateRebuild/start", params);
    }

    @PostMapping("/records")
    public ResponseUtil records(@RequestBody Map<String, Object> request) {
        requireManager();
        if (!remote.isRemote()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Template rebuild requires managed MicroVM Platform");
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("serviceKey", request.get("serviceKey"));
        params.put("pageNo", request.getOrDefault("pageNo", 1));
        params.put("pageSize", request.getOrDefault("pageSize", 10));
        return remote.controller("templateRebuild/records", params);
    }

    private void requireManager() {
        if (!CurrentUserHolder.isPlatformManager()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Platform manager required");
    }
}
