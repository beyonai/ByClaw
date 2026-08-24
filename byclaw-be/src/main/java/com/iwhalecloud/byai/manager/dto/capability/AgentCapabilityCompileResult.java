package com.iwhalecloud.byai.manager.dto.capability;

import java.util.List;

import lombok.Getter;
import lombok.Setter;

/**
 * Agent 能力卡编译产物；字段语义与 byclaw-super 的 AgentCapabilityCompileResult 一致。
 *
 * @author tangs
 */
@Getter
@Setter
public class AgentCapabilityCompileResult {

    /**
     * 能力卡 schema 版本。
     */
    private String schemaVersion;

    /**
     * 生成器版本。
     */
    private String generatorVersion;

    /**
     * 归一化输入的 sha256 指纹，用于判断来源是否变化。
     */
    private String sourceFingerprint;

    /**
     * 能力卡正文。
     */
    private Card card;

    /**
     * 供路由器使用的平铺文本。
     */
    private String routingText;

    /**
     * 编译质量评估。
     */
    private Quality quality;

    @Getter
    @Setter
    public static class Card {

        private String summary;
        private List<String> capabilities;
        private List<String> bestFor;
        private List<String> requires;
        private List<String> delivers;
        private List<String> limitations;
        private List<String> keywords;
    }

    @Getter
    @Setter
    public static class Quality {

        /**
         * 置信度：low / medium / high。
         */
        private String confidence;

        /**
         * 来源中缺失的关键信息。
         */
        private List<String> missingInformation;

        /**
         * 来源冲突或歧义告警。
         */
        private List<String> warnings;
    }
}
