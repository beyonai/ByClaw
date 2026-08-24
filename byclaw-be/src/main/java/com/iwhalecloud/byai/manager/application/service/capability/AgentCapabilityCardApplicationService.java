package com.iwhalecloud.byai.manager.application.service.capability;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.manager.domain.capability.service.AgentCapabilityCardService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.capability.AgentCapabilityCompileInput;
import com.iwhalecloud.byai.manager.dto.capability.AgentCapabilityCompileResult;
import com.iwhalecloud.byai.manager.entity.capability.AgentCapabilityCardEntity;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.capability.AgentCapabilityCardMapper;

import lombok.extern.slf4j.Slf4j;

/**
 * Agent 能力卡应用服务：编排编译与持久化。
 *
 * <p>权限关系仍由权威 Agent Catalog（ss_resource）管理；本服务只负责生成与保存能力卡快照。</p>
 *
 * @author tangs
 */
@Slf4j
@Service
public class AgentCapabilityCardApplicationService {

    private static final String DEFAULT_SYSTEM_CODE = "BYAI";

    @Autowired
    private AgentCapabilityCardService capabilityCardService;

    @Autowired
    private AgentCapabilityCardMapper capabilityCardMapper;

    @Autowired
    private SsResourceService ssResourceService;

    /**
     * 仅编译能力卡，不落库。
     *
     * @param input 编译输入
     * @return 编译产物
     */
    public AgentCapabilityCompileResult compile(AgentCapabilityCompileInput input) {
        requireInput(input);
        return capabilityCardService.compile(input);
    }

    /**
     * 编译并 upsert 能力卡。systemCode 优先取自 ss_resource，缺失时回退 BYAI，
     * 与 byclaw-super 的 backfill 脚本保持一致。
     *
     * @param agentId Agent 资源标识
     * @param input   编译输入
     * @return 编译产物
     */
    public AgentCapabilityCompileResult compileAndUpsert(Long agentId, AgentCapabilityCompileInput input) {
        requireInput(input);
        if (agentId == null) {
            throw new BaseException("agentId is required");
        }

        AgentCapabilityCompileResult compiled = capabilityCardService.compile(input);
        String systemCode = resolveSystemCode(agentId);

        AgentCapabilityCardEntity entity = new AgentCapabilityCardEntity();
        entity.setSystemCode(systemCode);
        entity.setAgentId(String.valueOf(agentId));
        entity.setAgentCode(StringUtils.trimToNull(input.getAgent().getCode()));
        entity.setAgentName(input.getAgent().getName());
        entity.setSchemaVersion(compiled.getSchemaVersion());
        entity.setGeneratorVersion(compiled.getGeneratorVersion());
        entity.setSourceFingerprint(compiled.getSourceFingerprint());
        entity.setCard(JsonUtil.toJSONString(compiled.getCard()));
        entity.setRoutingText(compiled.getRoutingText());
        entity.setQuality(JsonUtil.toJSONString(compiled.getQuality()));
        entity.setStatus("ACTIVE");
        capabilityCardMapper.upsert(entity);
        log.info("Capability card upserted systemCode={}, agentId={}, fingerprint={}",
            systemCode, agentId, compiled.getSourceFingerprint());
        return compiled;
    }

    private String resolveSystemCode(Long agentId) {
        try {
            SsResource resource = ssResourceService.findById(agentId);
            if (resource != null && StringUtils.isNotBlank(resource.getSystemCode())) {
                return resource.getSystemCode();
            }
        } catch (Exception e) {
            log.warn("resolveSystemCode failed for agentId={}, fallback to {}", agentId, DEFAULT_SYSTEM_CODE, e);
        }
        return DEFAULT_SYSTEM_CODE;
    }

    private void requireInput(AgentCapabilityCompileInput input) {
        if (input == null || input.getAgent() == null) {
            throw new BaseException("Capability compile input is required");
        }
    }
}
