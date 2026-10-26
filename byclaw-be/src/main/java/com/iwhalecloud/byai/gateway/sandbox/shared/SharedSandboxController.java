package com.iwhalecloud.byai.gateway.sandbox.shared;

import java.util.*;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** 前端只访问 BE；管理权限与租户过滤在转发平台之前确定。 */
@RestController
@RequestMapping("/sandbox/shared")
public class SharedSandboxController {
    private static final Set<String> READ = Set.of("listRecords", "listMembers");
    private static final Set<String> ADMIN = Set.of("listConfigs", "saveConfig", "deleteConfig", "releaseInstance");
    private final SharedSandboxGateway gateway;

    public SharedSandboxController(SharedSandboxGateway gateway) {
        this.gateway = gateway;
    }

    @PostMapping("/{operation}")
    public ResponseUtil<?> call(@PathVariable String operation, @RequestBody Map<String, Object> input) {
        if (!READ.contains(operation) && !ADMIN.contains(operation)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        boolean platform = CurrentUserHolder.isPlatformManager();
        if (!platform && (!READ.contains(operation) || !CurrentUserHolder.isBusinessAdmin())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        Map<String, Object> params = new LinkedHashMap<>(input);
        // 不能允许请求体伪造可信权限或用户投影。
        params.remove("userInfo");
        params.remove("platformManager");
        params.remove("operatorUserCode");
        params.remove("tenantScope");
        if (!platform) {
            Long tenant = CurrentUserHolder.getEnterpriseId();
            if (tenant == null || tenant <= 0) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
            params.put("enterpriseId", tenant);
            params.put("tenantScope", tenant);
        }
        params.put("operatorUserCode", CurrentUserHolder.getCurrentUserCode());
        params.put("platformManager", platform);
        return ResponseUtil.successResponse(gateway.call(operation, params));
    }
}
