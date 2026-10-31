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

    /**
     * 判断租户群聊数据是否存放在 ByClaw 公共库。
     *
     * 默认企业 1 是历史存量数据，免费试用租户虽然有真实 enterpriseId，
     * 也沿用公共库，不启动独立 Node；标准租户才需要转发到自己的 Node。
     */
    public boolean isSharedDataTenant(long enterpriseId) {
        return enterpriseId == 1L || isTrialTenant(enterpriseId);
    }
}
