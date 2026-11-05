package com.iwhalecloud.byai.gateway.sandbox.shared;

import static com.iwhalecloud.byai.gateway.sandbox.shared.SharedSandboxPolicyConfig.SHARED;

import com.alibaba.fastjson.JSON;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

/**
 * 每次共享路由前检查当前使用资格；映射和在途任务的生命周期由平台管理。
 */
@Component
public class SharedSandboxPolicy {


    private static final Logger log = org.slf4j.LoggerFactory.getLogger(SharedSandboxPolicy.class);

    public static final String USER_NAS = "BYCLAW_SANDBOX_SHARED_USER_NAS_ENABLED";
    public static final String POLICY = "BYCLAW_SANDBOX_SHARED_POLICY";
    public static final String BY_TENANT = "BYCLAW_SANDBOX_SHARED_BY_TENANT";

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    /**
     * 每次读取策略并直接反序列化为配置对象；读取或解析失败时记录堆栈并返回无共享资格。
     *
     * @param userCode 用户工号，匹配时去除首尾空白并区分大小写
     * @return 用户具有共享资格时为 true；工号为空或不符合策略时为 false
     */
    public boolean eligible(String userCode) {
        if (StringUtils.isBlank(userCode)) {
            return false;
        }
        try {
            String value = byaiSystemConfigService.getDcSystemConfigValueByCode(POLICY);
            SharedSandboxPolicyConfig policy = JSON.parseObject(value, SharedSandboxPolicyConfig.class);
            return eligible(policy, userCode);
        } catch (Exception unavailable) {
            log.error(unavailable.getMessage(), unavailable);
            return false;
        }
    }


    /**
     * 根据配置对象判断资格：默认共享且不在排除名单中的有效用户才可共享。
     *
     * @param policy   反序列化后的策略对象，允许为 null
     * @param userCode 用户工号，匹配时去除首尾空白并区分大小写
     * @return 默认模式为共享、工号非空且未被排除时为 true，否则为 false
     */
    public static boolean eligible(SharedSandboxPolicyConfig policy, String userCode) {
        return StringUtils.isNotBlank(userCode) && policy != null && SHARED.equals(policy.getDefaultMode())
            && policy.getExcludedUsers() != null
            && policy.getExcludedUsers().stream().noneMatch(user -> userCode.trim().equals(StringUtils.trim(user)));
    }

    /**
     * 用户 NAS 仅对开启 NAS 策略且具有共享资格的 DSH 用户生效。
     *
     * @param userCode   用户工号
     * @param serviceKey 沙箱服务标识，仅 byclaw-dsh 支持此策略
     * @return NAS 开关开启且用户具有 DSH 共享资格时为 true，否则为 false
     * @throws com.iwhalecloud.byai.state.common.exception.BdpRuntimeException NAS 开关值非法
     */
    public boolean userNasEnabled(String userCode, String serviceKey) {
        if (!SharedSandboxGateway.DSH_SERVICE.equals(serviceKey)) {
            return false;
        }
        String value = StringUtils.trimToEmpty(byaiSystemConfigService.getDcSystemConfigValueByCode(USER_NAS));
        if (value.isEmpty() || "0".equals(value)) {
            return false;
        }
        if (!"1".equals(value)) {
            throw new com.iwhalecloud.byai.state.common.exception.BdpRuntimeException("INVALID_SHARED_USER_NAS_POLICY");
        }
        return eligible(userCode);
    }

    /**
     * 判断共享池是否按租户隔离；配置读取异常向上传递，不猜测分池策略。
     *
     * @return 分池开关值去除首尾空白后为 1 时返回 true，否则返回 false
     */
    public boolean byTenant() {
        // 分池策略不可读时不猜测全局池，防止本应隔离的租户进入同一实例。
        return "1".equals(StringUtils.trimToEmpty(byaiSystemConfigService.getDcSystemConfigValueByCode(BY_TENANT)));
    }
}
