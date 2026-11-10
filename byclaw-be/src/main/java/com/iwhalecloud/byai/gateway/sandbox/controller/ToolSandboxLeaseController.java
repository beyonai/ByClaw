package com.iwhalecloud.byai.gateway.sandbox.controller;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Session leases are always scoped to the authenticated tool sandbox owner. */
@RestController
@RequestMapping("/sandbox/toolLease")
public class ToolSandboxLeaseController {
    private static final Set<String> OPERATIONS = Set.of("acquire", "renew", "release");
    private static final Set<String> FIELDS = Set.of("userCode", "serviceKey", "sessionId", "toolSessionId",
        "holderId", "leaseId", "leaseToken", "parentContextId", "parentContextGeneration", "parentSandboxId",
        "sandboxId", "expectedSandboxId", "destroy", "toolEnvironmentKeys", "idleTimeoutSeconds");
    private final PlatformRemoteGateway platform;

    public ToolSandboxLeaseController(PlatformRemoteGateway platform) {
        this.platform = platform;
    }

    @PostMapping("/{operation}")
    public ResponseUtil operation(@PathVariable String operation, @RequestBody Map<String, Object> request) {
        String owner = CurrentUserHolder.getCurrentUserCode();
        if (owner == null || owner.isBlank()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if (!OPERATIONS.contains(operation) || request == null || !FIELDS.containsAll(request.keySet()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid tool lease request");
        Object requestedOwner = request.get("userCode");
        if (requestedOwner != null && !owner.equals(requestedOwner))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Tool leases require the authenticated owner");
        if (!platform.isRemote())
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Tool lease coordinator is unavailable");
        Map<String, Object> params = new LinkedHashMap<>(request);
        params.put("userCode", owner);
        return ResponseUtil.successResponse(platform.toolLease(operation, params));
    }
}
