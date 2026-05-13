package com.iwhalecloud.byai.manager.dto.datacloud;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.util.List;

/**
 * 场景配置保存DTO
 * 用于保存录制的脚本场景配置
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
public class DatacloudScriptScenarioConfigDTO {

    /**
     * 脚本ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long scriptId;

    /**
     * 脚本步骤列表
     */
    private List<ScriptStepDTO> scriptStepList;

    /**
     * 目标脚本列表
     */
    private List<TargetScriptDTO> targetScriptList;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long creatorId;

    /**
     * 脚本步骤DTO
     */
    @Data
    public static class ScriptStepDTO {
        /**
         * 模板ID
         */
        @JsonSerialize(using = ToStringSerializer.class)
        private Long templateId;

        /**
         * 脚本内容
         */
        private ScriptContentDTO scriptContent;

        private String scriptDesc;

        /**
         * 参数变量定义
         */
        private List<MetaInfoDTO> metaInfos;
    }

    /**
     * 脚本内容DTO
     */
    @Data
    public static class ScriptContentDTO {
        /**
         * NodeJS脚本内容
         */
        private String nodejs;

        /**
         * Python脚本内容
         */
        private String python;
    }

    /**
     * 参数变量定义DTO
     */
    @Data
    public static class MetaInfoDTO {
        /**
         * 字段编码
         */
        private String fieldCode;

        /**
         * 字段类型
         */
        private String fieldType;

        /**
         * 组件类型
         */
        private String compType;

        /**
         * 字段名称
         */
        private String fieldName;

        /**
         * 是否必填
         */
        private Boolean required;

        /**
         * 描述
         */
        private String desc;

        /**
         * 示例）
         */
        private String example;
    }

    /**
     * 目标脚本DTO
     */
    @Data
    public static class TargetScriptDTO {
        /**
         * 动作脚本
         */
        private ActionScriptDTO actionScript;

        /**
         * 目标选择器
         */
        private String targetSelector;

        /**
         * 类型
         */
        private String type;

        /**
         * 扩展参数
         */
        private Object extParams;

        /**
         * 参数变量定义
         */
        private List<MetaInfoDTO> metaInfos;

        /**
         * 下一页选择器
         */
        private String nextPageSelector;

        /**
         * 最大翻页数
         */
        private String maxPages;
    }

    /**
     * 动作脚本DTO
     */
    @Data
    public static class ActionScriptDTO {
        /**
         * NodeJS脚本内容
         */
        private String nodejs;

        /**
         * Python脚本内容
         */
        private String python;
    }
}
