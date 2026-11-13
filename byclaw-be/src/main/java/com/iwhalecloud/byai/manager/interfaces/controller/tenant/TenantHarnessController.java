package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.tenant.integration.TenantHarnessProvisioningWorker;
import com.iwhalecloud.byai.manager.domain.tenant.integration.TenantHarnessProvisioningWorker.HarnessStatus;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/admin/tenants/1/harness")
public class TenantHarnessController {

    private final TenantHarnessProvisioningWorker worker;

    public TenantHarnessController(TenantHarnessProvisioningWorker worker) {
        this.worker = worker;
    }

    @PostMapping("/ensure")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ResponseUtil<HarnessStatus> ensure(@RequestBody EnsureRequest request) {
        requirePlatformManager();
        Long operator = CurrentUserHolder.getCurrentUserId();
        if (operator == null || operator <= 0) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "tenant.login.required");
        }
        return ResponseUtil.success(worker.submit(operator, request.profileKey()));
    }

    @GetMapping
    public ResponseUtil<HarnessStatus> status() {
        requirePlatformManager();
        return ResponseUtil.success(worker.status());
    }

    private void requirePlatformManager() {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "tenant.admin.required");
        }
    }

    public record EnsureRequest(String profileKey) { }
}
