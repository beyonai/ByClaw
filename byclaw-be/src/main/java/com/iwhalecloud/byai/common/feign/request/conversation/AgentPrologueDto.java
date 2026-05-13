package com.iwhalecloud.byai.common.feign.request.conversation;

import com.iwhalecloud.byai.common.feign.response.knowledge.FileUploadConfig;
import lombok.Data;

/**
 * @author zht
 * @version 1.0
 * @date 2024/12/19
 */
@Data
public class AgentPrologueDto {
    /**
     * 模型配置
     */
    private ModelInfo modelInfo;

    /**
     * 开场白
     */
    private String descText;

    /**
     * 人设描述:
     */
    private String role;

    /**
     * 背景:
     */
    private String background;

    /**
     * 开场引导问题
     */
    private String openingQuestion;

    /**
     * 知识库检索配配置
     */
    private DatasetSearchConfig datasetSearchConfig;

    /**
     * 默认知识库ID。
     */
    private Long defaultDatasetId;

    /**
     * 开场白
     */
    private String prologueText;

    /**
     * 调用方式 auto:自动调用，recognition:意图识别
     */
    private String callType;

    /**
     * 文件上传相关配置信息
     */
    private FileUploadConfig fileUpload;

    @Data
    public static class ModelInfo {
        /**
         * model
         */
        private String model;

        /**
         * modelid
         */
        private Long modelId;

        /**
         * 回复上限
         */
        private Integer maxToken;

        /**
         * 温度
         */
        private String temperature;

        /**
         * 历史记录
         */
        private Integer history;
    }

    @Data
    public static class DatasetSearchConfig {

        /**
         * 检索方�?embedding:语义，fullTextRecall:全文检索，mixedRecall:混合检�?
         */
        private String searchMode = "embedding";

        /**
         * 相关�?
         */
        private Number similarity = 0.6;

        /**
         * 引用上限
         */
        private Number limit = 5;

        /**
         * 知识库引用上限（token数）
         */
        private Number datasetQuoteToken = 0;

        /**
         * 是否使用重排
         */
        private Boolean rerankFlag;

        /**
         * 重排模型
         */
        private String rerankerModel;

        /**
         * 重排模型权重
         */
        private Double weight;
    }

}
