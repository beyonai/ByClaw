package com.iwhalecloud.byai.state.common.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ResourceInfoDto {

    /**
     * 资源对象Id
     */
    private String objId;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源类型 1-数字员工 2-文档库 3-插件 4-数据库
     */
    private String resourceType;
}
