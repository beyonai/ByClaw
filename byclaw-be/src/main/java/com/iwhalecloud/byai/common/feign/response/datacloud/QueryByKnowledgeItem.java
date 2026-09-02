package com.iwhalecloud.byai.common.feign.response.datacloud;

import lombok.Getter;
import lombok.Setter;

/**
 * 按知识库查询对象列表中的单条对象基本信息。
 */
@Getter
@Setter
public class QueryByKnowledgeItem {

    private String objectCode;

    private String objectName;

    private String objectDesc;

    private String objectSource;

    private Integer fieldCount;

    private Integer actionCount;

    private String ownerType;

    private String userCode;

    /** 本次查询使用的本体库 ID */
    private String baseId;

    /** 对象关联的知识库资源 ID */
    private String kbResourceId;

    /** 对象关联的知识库目录 */
    private String kbDirectory;
}
