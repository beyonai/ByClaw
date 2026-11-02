package com.iwhalecloud.byai.common.feign.request.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/** 查询指定知识库所有层级的未删除文件数量。 */
@Getter
@Setter
public class KbKnowledgeFileCount {

    private String knCode;
}
