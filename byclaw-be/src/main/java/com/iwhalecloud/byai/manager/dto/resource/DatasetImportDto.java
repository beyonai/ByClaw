package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

/**
 * 知识库JSON导入DTO
 */
@Getter
@Setter
public class DatasetImportDto {

    private Long resourceSourcePkId;

    private String resourceName;

    private String resourceDesc;

    /**
     * 知识库大类：dataset-百应知识库，external-第三方知识库
     */
    private String resourceType;

    /**
     * 一级分类：enterprise-企业知识库，personal-个人知识库
     */
    private String ownerType;

    /**
     * 二级分类：KG_DOC-文档知识库，KG_DB-数据知识库，KG_TERM-术语知识库，KG_QA-问答知识库
     */
    private String resourceCatalogSub;

    private String resourceCode;

    private String version;

    private String resourceBizType;

    private String systemCode;

    private String domainName;

    private String domainURL;

    private Long catalogId;

    /**
     * 知识库服务列表，保留原始JSON结构
     */
    private Object resourceService;
}
