package com.iwhalecloud.byai.common.feign.request.datacloud;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 按知识库查询对象列表请求（POST /api/v1/ontologyBases/objects/queryByKnowledge）。
 */
@Getter
@Setter
public class QueryByKnowledgeReq {

    /** 知识库资源 ID */
    private String kbResourceId;

    /** 知识库目录路径列表；非空时匹配任一目录 */
    private List<String> kbDirectories;

    /** 对象名称，不区分大小写的包含匹配 */
    private String objectName;

    /** 页码，从 1 开始 */
    private Integer pageIndex = 1;

    /** 每页数量，范围 1–1000 */
    private Integer pageSize = 20;
}
