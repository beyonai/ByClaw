package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 创建知识库请求体（POST /api/v1/knowledge-bases/create），见 docs/api/api.md。
 */
@Getter
@Setter
public class KbKnowledgeCreate {

    /**
     * 知识库名称，必填
     */
    private String knName;

    /**
     * 知识库描述，可选
     */
    private String knDescription;
}
