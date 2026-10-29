package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.manager.domain.tenant.TenantAvailableView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantContextService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantSwitchView;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

@RestController
@RequestMapping("/tenantContext")
public class TenantContextController {

    private final TenantContextService tenantContextService;

    public TenantContextController(TenantContextService tenantContextService) {
        this.tenantContextService = tenantContextService;
    }

    @GetMapping("/available")
    public ResponseUtil<List<TenantAvailableView>> available() {
        return ResponseUtil.success(tenantContextService.available());
    }

    @PostMapping("/switch")
    public ResponseUtil<TenantSwitchView> switchTo(@RequestBody SwitchRequest request) {
        return ResponseUtil.success(tenantContextService.switchTo(request.enterpriseId()));
    }

    public record SwitchRequest(String enterpriseId) {
    }
}
