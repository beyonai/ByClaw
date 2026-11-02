package com.iwhalecloud.byai.gateway.sandbox.shared;

import java.util.Arrays;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

/** 每次共享路由前检查当前使用资格；映射和在途任务的生命周期由平台管理。 */
@Component
public class SharedSandboxPolicy {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(SharedSandboxPolicy.class);
    public static final String USER_NAS = "BYCLAW_SANDBOX_SHARED_USER_NAS_ENABLED";
    public static final String USERS = "BYCLAW_SHARED_DSH_HOST_USERS";
    public static final String ALL = "BYCLAW_SANDBOX_SHARED_ALL";
    public static final String BY_TENANT = "BYCLAW_SANDBOX_SHARED_BY_TENANT";
    private final ByaiSystemConfigService config;

    public SharedSandboxPolicy(ByaiSystemConfigService config) {
        this.config = config;
    }

    public boolean eligible(String userCode) {
        if (StringUtils.isBlank(userCode)) return false;
        try {
            if ("1".equals(StringUtils.trimToEmpty(config.getDcSystemConfigValueByCode(ALL)))) return true;
            String list = StringUtils.trimToEmpty(config.getDcSystemConfigValueByCode(USERS));
            return !list.isEmpty() && !"*".equals(list)
                && Arrays.asList(list.split("[,;\\s]+")).contains(userCode.trim());
        }
        catch (RuntimeException unavailable) {
            log.warn("Shared sandbox eligibility configuration unavailable, userCode={}, cause={}",
                userCode, unavailable.getClass().getSimpleName());
            throw new com.iwhalecloud.byai.state.common.exception.BdpRuntimeException("共享沙箱入口配置读取失败，请稍后重试");
        }
    }

    public boolean userNasEnabled(String userCode, String serviceKey) {
        if (!SharedSandboxGateway.DSH_SERVICE.equals(serviceKey)) return false;
        String value = StringUtils.trimToEmpty(config.getDcSystemConfigValueByCode(USER_NAS));
        if (value.isEmpty() || "0".equals(value)) return false;
        if (!"1".equals(value)) throw new com.iwhalecloud.byai.state.common.exception.BdpRuntimeException("INVALID_SHARED_USER_NAS_POLICY");
        return eligible(userCode);
    }

    public boolean byTenant() {
        // 分池策略不可读时不猜测全局池，防止本应隔离的租户进入同一实例。
        return "1".equals(StringUtils.trimToEmpty(config.getDcSystemConfigValueByCode(BY_TENANT)));
    }
}
