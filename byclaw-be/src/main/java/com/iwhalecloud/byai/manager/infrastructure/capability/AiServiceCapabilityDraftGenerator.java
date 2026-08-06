package com.iwhalecloud.byai.manager.infrastructure.capability;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.capability.service.AgentCapabilityCardService;
import com.iwhalecloud.byai.manager.domain.capability.service.AgentCapabilityDraftGenerator;
import com.iwhalecloud.byai.manager.dto.capability.AgentCapabilityCompileInput;

import lombok.extern.slf4j.Slf4j;

/**
 * 基于 byclaw-be {@link AIService} 的能力卡草稿生成器：调用 OpenAI 兼容接口的 JSON 模式产出结构化草稿。
 *
 * <p>对齐 byclaw-super 的 {@code PiAgentCapabilityDraftGenerator}：固定 maxTokens=3000，
 * 系统/用户消息格式一致；超时与重试由 {@link AIService} 统一处理。</p>
 *
 * @author tangs
 */
@Slf4j
@Component
public class AiServiceCapabilityDraftGenerator implements AgentCapabilityDraftGenerator {

    /** 能力卡草稿生成最大输出 token，与 byclaw-super 保持一致。 */
    private static final int MAX_TOKENS = 3_000;

    @Autowired
    private AIService aiService;

    @Autowired
    private AiModelService aiModelService;

    @Override
    public String generate(AgentCapabilityCompileInput input) {
        ModelDto model = aiModelService.getDefaultChatModel();
        if (model == null) {
            throw new BaseException("No default chat model configured for capability card generation");
        }
        String userPrompt = AgentCapabilityCardService.agentSourceForPrompt(input);
        try {
            String json = aiService.generateJsonObject(
                AgentCapabilityCardService.systemPrompt(), userPrompt, model, MAX_TOKENS);
            if (StringUtils.isBlank(json)) {
                throw new BaseException("Capability model returned an empty card");
            }
            return json;
        } catch (BaseException e) {
            throw e;
        } catch (Exception e) {
            throw new BaseException("Capability card generation failed", e);
        }
    }
}
