package com.iwhalecloud.byai.manager.dto.capability;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * Agent 能力卡编译输入；与 byclaw-super 的 AgentCapabilityCompileInput 保持一致，
 * 字段长度上限由 {@code AgentCapabilityCardService} 在归一化阶段统一裁剪。
 *
 * @author tangs
 */
@Getter
@Setter
public class AgentCapabilityCompileInput {

    /**
     * 输出语言区域，默认 zh-CN。
     */
    private String locale;

    /**
     * Agent 能力来源描述。
     */
    private Agent agent;

    @Getter
    @Setter
    public static class Agent {

        /**
         * Agent 业务编码。
         */
        private String code;

        /**
         * Agent 名称（必填）。
         */
        private String name;

        /**
         * Agent 描述。
         */
        private String description;

        /**
         * 系统指令 / 人设定义。
         */
        private String instructions;

        /**
         * 技能来源。
         */
        private List<SourceItem> skills;

        /**
         * 工具来源。
         */
        private List<SourceItem> tools;

        /**
         * 知识领域。
         */
        private List<String> knowledgeDomains;

        /**
         * 输入类型。
         */
        private List<String> inputTypes;

        /**
         * 输出类型。
         */
        private List<String> outputTypes;

        /**
         * 约束。
         */
        private List<String> constraints;

        /**
         * 示例（问答对）。
         */
        private List<Example> examples;
    }

    @Getter
    @Setter
    public static class SourceItem {

        private String code;
        private String name;
        private String description;
    }

    @Getter
    @Setter
    public static class Example {

        private String request;
        private String expectedOutcome;
    }
}
