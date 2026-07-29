package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 删除知识库请求体（POST /api/v1/knowledgeBases/delete），见 docs/api/api.md。
 *
 * @author qin.guoquan
 * @date 2026-07-14 19:38:38
 */
@Getter
@Setter
public class KbKnowledgeDelete {

    /**
     * 知识库编码，必填
     */
    private String knCode;
}
