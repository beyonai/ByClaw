package com.iwhalecloud.byai.manager.dto.digitemploy;

import lombok.Data;

import java.util.List;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/12/12 10:43
 */
@Data
public class RelResourceInfo {

    public static final double DEFAULT_SIMILARITY = 0.6D;

    public static final int DEFAULT_TOP_K = 20;

    /**
     * 关联资源ID
     */
    private String relId;

    /**
     * 可用的资源ID列表
     */
    private List<String> activeResourceIds;

    /**
     * 数字员工关联知识库的检索配置，仅 DATASET_SYSTEM=WHALE_AGENT 时生效。
     */
    private KnowledgeSearchConfig knowledgeSearchConfig;

    @Data
    public static class KnowledgeSearchConfig {

        /**
         * 最小匹配度，取值范围 [0, 1]。
         */
        private Double similarity = DEFAULT_SIMILARITY;

        /**
         * 最大召回数量，取值范围 [1, 100]。
         */
        private Integer topK = DEFAULT_TOP_K;
    }
}
