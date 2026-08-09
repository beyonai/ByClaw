package com.iwhalecloud.byai.manager.domain.capability.service;

import com.iwhalecloud.byai.manager.dto.capability.AgentCapabilityCompileInput;

/**
 * Agent 能力卡草稿生成端口；仅负责调用大模型产出结构化草稿，
 * 版本、指纹、置信度与最终文本格式由 {@link AgentCapabilityCardService} 确定性裁剪。
 *
 * @author tangs
 */
public interface AgentCapabilityDraftGenerator {

    /**
     * 调用大模型生成能力卡草稿。
     *
     * @param input 归一化后的编译输入
     * @return 模型返回的原始 JSON 文本
     */
    String generate(AgentCapabilityCompileInput input);
}
