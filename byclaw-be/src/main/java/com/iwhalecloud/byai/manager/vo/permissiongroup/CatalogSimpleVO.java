package com.iwhalecloud.byai.manager.vo.permissiongroup;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.iwhalecloud.byai.common.util.LongToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 权限组目录简化视图对象
 * 用于权限组和目录联合查询的目录信息返回
 */
@Getter
@Setter
public class CatalogSimpleVO {

    /**
     * 目录ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long catalogId;

    /**
     * 目录名称
     */
    private String catalogName;

    /**
     * 目录路径，用.隔开，如：-1.1137
     */
    private String catalogPath;

    /**
     * 对象类型
     */
    private Integer objType;

    /**
     * 父目录ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long parentCatalogId;

    /**
     * 排序ID
     */
    private Integer sortId;

    /**
     * 状态：A-启用
     */
    private String state;

    /**
     * 用户ID
     */
    @JsonSerialize(using = LongToStringSerializer.class)
    private Long userId;

    /**
     * 目录描述
     */
    private String comments;

    /**
     * 是否系统目录
     */
    private String isSystem;

}

