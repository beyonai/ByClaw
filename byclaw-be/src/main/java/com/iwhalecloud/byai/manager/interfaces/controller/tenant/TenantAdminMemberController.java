package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import java.util.List;

import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminMemberService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminMemberService.TenantMemberView;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/tenants/members")
public class TenantAdminMemberController {

    private final TenantAdminMemberService service;

    public TenantAdminMemberController(TenantAdminMemberService service) {
        this.service = service;
    }

    @PostMapping("/list")
    public ResponseUtil<List<TenantMemberView>> list(@RequestBody ListMembersRequest request) {
        return ResponseUtil.success(service.list(request.enterpriseId()));
    }

    @PostMapping("/add")
    public ResponseUtil<TenantMemberView> add(@RequestBody AddMemberRequest request) {
        return ResponseUtil.success(service.add(request.enterpriseId(), request.userCode()));
    }

    public record ListMembersRequest(String enterpriseId) {
    }

    public record AddMemberRequest(String enterpriseId, String userCode) {
    }
}
