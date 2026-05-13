package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/**
 * 创建知识库成功时 resultObject 结构，见 docs/api/api.md。
 */
@Getter
@Setter
public class KnowledgeBaseInfo {

    private String knCode;

    private String knName;

    private String knDescription;
}
