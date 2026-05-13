package com.iwhalecloud.byai.state.common.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum KnowledgeQueryTypeEnum {

    /*
     * 语义检索
     */
    EMBEDDING("embedding"),

    /*
     * 全文检索
     */
    FULLTEXTRECALL("fullTextRecall"),

    /*
     * 混合检索
     */
    MIXEDRECALL("mixedRecall");

    private final String value;

}
