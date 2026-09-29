package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import java.util.List;

import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDeletionService;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TenantSandboxView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService.TenantView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService.PackageView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService.TenantListFilter;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/tenants")
public class TenantAdminTenantController {

    private final TenantAdminTenantService service;
    private final TenantDbProvisioningService provisioner;
    private final TenantDeletionService deletion;

    public TenantAdminTenantController(TenantAdminTenantService service, TenantDbProvisioningService provisioner,
                                       TenantDeletionService deletion) {
        this.service = service;
        this.provisioner = provisioner;
        this.deletion = deletion;
    }

    @PostMapping("/list")
    public ResponseUtil<List<TenantView>> list(@RequestBody(required = false) TenantListFilter filter) {
        return ResponseUtil.success(service.list(filter));
    }

    @PostMapping("/packages/list")
    public ResponseUtil<List<PackageView>> packages(@RequestBody(required = false) ListTenantsRequest ignored) {
        return ResponseUtil.success(service.packages());
    }

    @PostMapping("/create")
    public ResponseUtil<TenantView> create(@RequestBody CreateTenantRequest request) {
        TenantView tenant = service.create(request.enterpriseName(), request.packageId(), request.requestId());
        provisioner.request(Long.parseLong(tenant.enterpriseId()));
        return ResponseUtil.success(tenant);
    }

    @PostMapping("/provision")
    public ResponseUtil<String> provision(@RequestBody ProvisionTenantRequest request) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "platform administrator required");
        }
        if (request.enterpriseId() == null || !request.enterpriseId().matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid enterprise ID");
        }
        provisioner.request(Long.parseLong(request.enterpriseId()));
        return ResponseUtil.success("ACCEPTED");
    }

    @PostMapping("/delete")
    public ResponseUtil<String> delete(@RequestBody DeleteTenantRequest request) {
        return ResponseUtil.success(deletion.request(request.enterpriseId(), request.enterpriseName()));
    }

    @PostMapping("/recreate-node")
    public ResponseUtil<TenantSandboxView> recreateNode(@RequestBody ProvisionTenantRequest request) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "platform administrator required");
        }
        if (request.enterpriseId() == null || !request.enterpriseId().matches("[1-9][0-9]*")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid enterprise ID");
        }
        return ResponseUtil.success(provisioner.recreateNode(Long.parseLong(request.enterpriseId())));
    }

    @PostMapping("/sandboxes/restart")
    public ResponseUtil<String> restartSandbox(@RequestBody RestartTenantSandboxRequest request) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "platform administrator required");
        }
        if (request.enterpriseId() == null || !request.enterpriseId().matches("[1-9][0-9]*")
            || request.recordId() == null || request.recordId() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid tenant sandbox identity");
        }
        provisioner.requestRestart(Long.parseLong(request.enterpriseId()), request.sandboxType(), request.recordId());
        return ResponseUtil.success("ACCEPTED");
    }

    public record ListTenantsRequest() {
    }

    public record CreateTenantRequest(String enterpriseName, long packageId, String requestId) {
    }

    public record ProvisionTenantRequest(String enterpriseId) {
    }

    public record DeleteTenantRequest(String enterpriseId, String enterpriseName) {
    }

    public record RestartTenantSandboxRequest(String enterpriseId, String sandboxType, Long recordId) {
    }
}
