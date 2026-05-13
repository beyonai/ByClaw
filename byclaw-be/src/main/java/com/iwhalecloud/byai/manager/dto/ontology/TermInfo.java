package com.iwhalecloud.byai.manager.dto.ontology;

import lombok.Getter;
import lombok.Setter;

/**
 * 术语信息DTO
 * 用于存储参数的术语信息
 *
 * @author system
 */
@Getter
@Setter
public class TermInfo {

    /**
     * 术语库ID
     */
    private String datasetId;

    /**
     * 术语类型编码
     */
    private String termTypeCode;

    /**
     * 术语类型ID
     */
    private String termTypeId;

    /**
     * 术语类型名称
     */
    private String termTypeName;

    /**
     * 术语编码/列表（术语数据类型） dict.list
     */
    private String termDataType;


    private String termField;
}

