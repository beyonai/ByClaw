package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import lombok.Getter;
import lombok.Setter;

/** 知识库未删除文件总数；不包括目录，不按构建状态筛选。 */
@Getter
@Setter
public class KnowledgeFileCountResult {

    private Long fileCount;
}
