package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * QA Markdown 文件引用关系查询请求。
 *
 * @author qin.guoquan
 * @date 2026-07-14 19:38:38
 */
@Getter
@Setter
public class KbKnowledgeItemReferences {

    private String knCode;

    private String filePath;

    private String direction;
}
