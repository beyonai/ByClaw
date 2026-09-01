package com.iwhalecloud.byai.state.domain.chat.service;

import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamCacheReader;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/**
 * Uses the global or personal ENABLE_DSH parameter to route chat messages to the user's DSH Worker.
 */
@Service
public class SystemParamTargetAgentResolver {

    private static final String ENABLE_PARAM_CODE = "ENABLE_DSH";

    private static final String TARGET_AGENT_PREFIX = "BYCLAW_DSH_";

    private final ByaiSystemConfigService systemConfigService;

    private final UserPrivateParamCacheReader privateParamCacheReader;

    private final SsResourceService ssResourceService;

    public SystemParamTargetAgentResolver(
            ByaiSystemConfigService systemConfigService,
            UserPrivateParamCacheReader privateParamCacheReader,
            SsResourceService ssResourceService
    ) {
        this.systemConfigService = systemConfigService;
        this.privateParamCacheReader = privateParamCacheReader;
        this.ssResourceService = ssResourceService;
    }

    public String resolve(String currentTargetAgentType, String userCode) {
        return resolve(currentTargetAgentType, null, userCode);
    }

    /**
     * Applies user-level DSH routing first, then routes HARNESS digital employees to DSH.
     */
    public String resolve(String currentTargetAgentType, Long agentId, String userCode) {
        if (StringUtils.isBlank(userCode)) {
            return currentTargetAgentType;
        }
        String normalizedUserCode = StringUtils.trim(userCode);
        String enabled = privateParamCacheReader.getValue(normalizedUserCode, ENABLE_PARAM_CODE);
        if (StringUtils.isBlank(enabled)) {
            enabled = systemConfigService.getDcSystemConfigValueByCode(ENABLE_PARAM_CODE);
        }
        if (!"1".equals(StringUtils.trim(enabled))) {
            if (!isHarnessAgent(agentId)) {
                return currentTargetAgentType;
            }
        }
        return TARGET_AGENT_PREFIX + normalizedUserCode;
    }

    private boolean isHarnessAgent(Long agentId) {
        if (agentId == null || ssResourceService == null) {
            return false;
        }
        try {
            SsResource resource = ssResourceService.findById(agentId);
            return resource != null && "HARNESS".equalsIgnoreCase(StringUtils.trim(resource.getWorkerAgentType()));
        }
        catch (Exception ignored) {
            return false;
        }
    }
}
