package com.iwhalecloud.byai.manager.dto.ontology;


import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class ObjectDto {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 对象名称
     */
    private String name;

    /**
     *
     */
    private String code;

    /**
     * 对象描述
     */
    private String desc;

    // 1-API 2-知识文档库  3-知识数据库
    private Integer type;

    /**
     * 目录
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long catalogId;

    private String catalogName;

    /**
     *  目录类型 6-领域 7-要素
     */
    private Integer catalogType;

    private Integer status;

    /**
     * 对象属性列表
     */
    private List<OntologyBatchSaveRequest.ObjectAttribute> attributes;

    /**
     * 动作列表（包含动作属性）
     */
    private List<OntologyDetailResponse.ActionDetail> actions;

}
