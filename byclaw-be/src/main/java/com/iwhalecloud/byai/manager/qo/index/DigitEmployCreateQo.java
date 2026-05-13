package com.iwhalecloud.byai.manager.qo.index;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 创建数字员工请求
 */
@Data
@Schema(name = "DigitEmployCreateQo", description = "创建数字员工请求")
public class DigitEmployCreateQo implements Serializable {
    /**
     * 数字员工名称
     */
    @Schema(description = "数字员工名称", example = "金融顾问")
    private String name;

    /**
     * 描述
     */
    @Schema(description = "数字员工描述", example = "提供专业的投资理财建议")
    private String intro;

    /**
     * 目录id （-1是我的关注，其他是目录）
     */
    @Schema(description = "目录ID", example = "123")
    private Long dirId;

    /**
     * 企业id
     */
    @Schema(description = "企业ID", example = "456")
    private Long enterpriseId;

    /**
     * focus、owner
     */
    @Schema(description = "类型", example = "focus", allowableValues = {"focus", "owner"})
    private String type;

    /**
     * 智能体id
     */
    @Schema(description = "智能体ID", example = "789")
    private Long appId;

    /**
     * 关联的插件工具id
     */
    @Schema(description = "插件工具列表")
    private List<CompositeAppMachineInfo> pluginMachineList;

    /**
     * 关联的知识库id
     */
    @Schema(description = "知识库ID列表")
    private List<Long> datasetIdList;

    /**
     * 关联的智能体id
     */
    @Schema(description = "关联智能体ID列表")
    private List<Long> relAppIdList;

    /**
     * 存储开场介绍模型信息
     * {
     * "prologueText": "你好", #开场问候语
     * "modelInfo": {
     * "modelId": 1, #模型id
     * "model": "WhaleGPT-14B", # 模型编码
     * "history": 0, # 历史记录
     * "temperature": 0, # 温度
     * "maxToken": 2000 # 最大回复
     * },
     * "descText": "智能体设定" #智能体设定
     * }
     */
    @Schema(description = "开场介绍模型信息(JSON格式)")
    private String prologue;

    /**
     * 关联的模型id
     */
    @Schema(description = "关联模型ID", example = "101")
    private Long relModelId;

    /**
     * 开场白信息
     */
    @Schema(description = "开场白信息列表")
    private List<InfoContentDto> openingIntroList;

    /**
     * 开场样例问题
     */
    @Schema(description = "开场样例问题列表")
    private List<InfoContentDto> sampleQuestionList;

    /**
     * 默认推荐提示词
     */
    @Schema(description = "推荐提示词配置")
    private RecommendPrompt recommendPrompt;

    /**
     * 智能体类型
     */
    @Schema(description = "智能体类型", example = "1")
    private Integer codeType;

    @Data
    @Schema(name = "CompositeAppMachineInfo", description = "插件工具信息")
    public static class CompositeAppMachineInfo implements Serializable {
        /**
         * 默认
         */
        @Schema(description = "是否默认", example = "1")
        private Long isDefault;

        /**
         * 类型 0：插件
         */
        @Schema(description = "工具类型", example = "0")
        private Integer type;

        /**
         * 工具id
         */
        @Schema(description = "工具ID", example = "tool_123")
        private String pluginMachineId;
    }

    @Data
    @Schema(name = "InfoContentDto", description = "信息内容")
    public static class InfoContentDto implements Serializable {
        /**
         * 标题
         */
        @Schema(description = "信息标题", example = "欢迎语")
        private String infoTitle;

        /**
         * 内容
         */
        @Schema(description = "信息内容", example = "您好，请问有什么可以帮您？")
        private String infoContent;

        /**
         * 图标
         */
        @Schema(description = "图标URL", example = "https://example.com/avatar.png")
        private String avatar;

        /**
         * 类型
         */
        @Schema(description = "信息类型", example = "1")
        private Integer infoType;
    }

    @Data
    @Schema(name = "RecommendPrompt", description = "推荐提示词配置")
    public static class RecommendPrompt implements Serializable {
        /**
         * 推荐提示词主键id
         */
        @Schema(description = "提示词ID", example = "1001")
        private Long id;

        /**
         * 智能体id
         */
        @Schema(description = "智能体ID", example = "789")
        private Long appId;

        /**
         * 标签
         */
        @Schema(description = "标签", example = "投资建议")
        private String label;

        /**
         * 提示词
         */
        @Schema(description = "提示词内容", example = "请分析当前股市行情")
        private String prompt;

        /**
         * 提示词模型
         */
        @Schema(description = "提示词模型", example = "gpt-4")
        private String model;

        /**
         * 是否使用 0: 否 1: 是
         */
        @Schema(description = "是否启用", example = "1")
        private Short enable;

        /**
         * 模型id
         */
        @Schema(description = "模型ID", example = "model_001")
        private Long modelId;
    }
}
