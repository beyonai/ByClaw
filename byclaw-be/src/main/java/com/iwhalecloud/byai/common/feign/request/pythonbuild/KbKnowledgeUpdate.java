package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 修改知识库请求体（POST /api/v1/knowledge-bases/update），见 docs/api/api.md。
 */
@Getter
@Setter
public class KbKnowledgeUpdate {

    /**
     * 知识库编码，必填
     */
    private String knCode;

    /**
     * 新知识库名称，可选
     */
    private String knName;

    /**
     * 新知识库描述，可选
     */
    private String knDescription;
}
