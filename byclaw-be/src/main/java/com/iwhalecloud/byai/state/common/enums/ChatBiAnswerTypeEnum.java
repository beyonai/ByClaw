package com.iwhalecloud.byai.state.common.enums;

import lombok.Getter;

/**
 * @author zht
 * @version 1.0
 * @date 2025/5/7
 */
@Getter
public enum ChatBiAnswerTypeEnum {

    /**
     * 默认的sse answer类型  --- 这种一般代指 ChatBi问数流程报错了，返回了文本话术
     * 文本
     */
    TEXT(0),

    /**
     * 数据源知识库 sse answer类型  --- ChatBi问数流程正常，返回了查询结果 JSON字符串
     * JSON
     */
    QUERY_DATA_RESULT(1),

    /**
     * 知识库意图识别 --- 意图识别 ChatBi问数流程正常，返回了查询结果 JSON字符串  跟QUERY_DATA_RESULT的JSON数据结果是一致的
     */
    KNOWLEDGE_ROUTER(11);
    ;

    private final Integer code;

    ChatBiAnswerTypeEnum(Integer code) {
        this.code = code;
    }
}
