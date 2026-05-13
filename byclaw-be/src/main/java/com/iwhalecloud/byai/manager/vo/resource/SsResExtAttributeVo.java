package com.iwhalecloud.byai.manager.vo.resource;


import com.iwhalecloud.byai.manager.entity.resource.SsResExtAttribute;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源扩展属性表实体类
 */
@Getter
@Setter
public class SsResExtAttributeVo extends SsResExtAttribute {

    /**
     * 別名 (额外字段用于中间存储)
     */
    private String alias;

    /**
     * 来源表编码 (额外字段用于中间存储)
     */
    private String sourceTableCode;

    private String perDataScopeType;


    /**
     * 关联术语类型名称
     */
    private String termTypeName;
    /**
     * 属于类型是枚举还是列表
     * 1-枚举
     * 2-列表
     */
    private String termDataType;
    /**
     * 术语库id
     */
    private String datasetId;

}

