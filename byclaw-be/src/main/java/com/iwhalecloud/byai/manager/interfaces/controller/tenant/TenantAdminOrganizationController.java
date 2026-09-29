package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import java.util.List;

import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminOrganizationService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminOrganizationService.AttachResult;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminOrganizationService.OrganizationMemberView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminOrganizationService.OrganizationView;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/tenants/organizations")
public class TenantAdminOrganizationController {

    private final TenantAdminOrganizationService service;

    public TenantAdminOrganizationController(TenantAdminOrganizationService service) {
        this.service = service;
    }

    @PostMapping("/tree")
    public ResponseUtil<List<OrganizationView>> tree(@RequestBody TenantRequest request) {
        return ResponseUtil.success(service.tree(request.enterpriseId()));
    }

    @PostMapping("/members")
    public ResponseUtil<List<OrganizationMemberView>> members(@RequestBody OrganizationRequest request) {
        return ResponseUtil.success(service.members(request.enterpriseId(), request.orgId(),
            request.includeDescendants()));
    }

    @PostMapping("/attach")
    public ResponseUtil<AttachResult> attach(@RequestBody AttachRequest request) {
        return ResponseUtil.success(service.attach(request.enterpriseId(), request.orgId(),
            request.includeDescendants(), request.addMembers()));
    }

    public record TenantRequest(String enterpriseId) {
    }

    public record OrganizationRequest(String enterpriseId, String orgId, boolean includeDescendants) {
    }

    public record AttachRequest(String enterpriseId, String orgId, boolean includeDescendants, boolean addMembers) {
    }
}
