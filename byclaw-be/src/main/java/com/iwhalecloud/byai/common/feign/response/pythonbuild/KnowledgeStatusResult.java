package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.math.BigDecimal;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/** QA 逻辑文件容量，spaceSize 单位为 1024 字节的 KB。 @author Codex @since 2026-11-02 */
@Getter
@Setter
public class KnowledgeStatusResult {
    private List<Item> data;

    /** 每个知识库独立返回统计，缺项不能视为空库。 */
    @Getter
    @Setter
    public static class Item {
        private String knCode;
        private Long fileCount;
        private BigDecimal spaceSize;
    }
}
