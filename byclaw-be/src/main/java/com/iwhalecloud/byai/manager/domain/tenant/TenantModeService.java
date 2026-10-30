package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import org.springframework.stereotype.Service;

/** 租户运行模式的公共判断入口；配置读取和取值约定只在此处封装。 */
@Service
public class TenantModeService {
    private final TenantAdminTenantMapper tenants;

    public TenantModeService(TenantAdminTenantMapper tenants) {
        this.tenants = tenants;
    }

    /** 判断租户是否使用试用模式（走公共逻辑，无独立 Node）；不判断商业有效期。 */
    public boolean isTrialTenant(long enterpriseId) {
        if (enterpriseId <= 0) {
            return false;
        }
        return "TRIAL".equals(tenants.selectConfig(enterpriseId, "TENANT_MODE"));
    }
}
