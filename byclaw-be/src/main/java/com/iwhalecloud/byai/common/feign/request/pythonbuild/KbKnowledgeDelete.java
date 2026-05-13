package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 删除知识库请求体（POST /api/v1/knowledge-bases/delete），见 docs/api/api.md。
 */
@Getter
@Setter
public class KbKnowledgeDelete {

    /**
     * 知识库编码，必填
     */
    private String knCode;
}
