package com.iwhalecloud.byai.state.domain.chat.service;

import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamCacheReader;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Uses a configured system parameter to override the resolved chat Worker.
 *
 * <p>The parameter code and target template are deployment configuration, so the routing path is reusable by any
 * external executor. The template may contain {@code {userCode}}.</p>
 */
@Service
public class SystemParamTargetAgentResolver {

    private final ByaiSystemConfigService systemConfigService;

    private final UserPrivateParamCacheReader privateParamCacheReader;

    private final String enableParamCode;

    private final String targetAgentTemplate;

    public SystemParamTargetAgentResolver(
            ByaiSystemConfigService systemConfigService,
            UserPrivateParamCacheReader privateParamCacheReader,
            @Value("${byclaw.chat.target-override.enable-param:}") String enableParamCode,
            @Value("${byclaw.chat.target-override.agent-template:}") String targetAgentTemplate
    ) {
        this.systemConfigService = systemConfigService;
        this.privateParamCacheReader = privateParamCacheReader;
        this.enableParamCode = StringUtils.trimToEmpty(enableParamCode);
        this.targetAgentTemplate = StringUtils.trimToEmpty(targetAgentTemplate);
    }

    public String resolve(String currentTargetAgentType, String userCode) {
        if (StringUtils.isBlank(enableParamCode) || StringUtils.isBlank(targetAgentTemplate)
            || StringUtils.isBlank(userCode)) {
            return currentTargetAgentType;
        }
        String normalizedUserCode = StringUtils.trim(userCode);
        String enabled = privateParamCacheReader.getValue(normalizedUserCode, enableParamCode);
        if (StringUtils.isBlank(enabled)) {
            enabled = systemConfigService.getDcSystemConfigValueByCode(enableParamCode);
        }
        if (!"1".equals(StringUtils.trim(enabled))) {
            return currentTargetAgentType;
        }
        return StringUtils.replace(targetAgentTemplate, "{userCode}", normalizedUserCode);
    }
}
