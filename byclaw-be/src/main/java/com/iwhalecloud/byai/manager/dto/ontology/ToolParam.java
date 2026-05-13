package com.iwhalecloud.byai.manager.dto.ontology;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 工具参数DTO
 * 用于存储工具的参数信息
 *
 * @author system
 */
@Getter
@Setter
public class ToolParam {

    /**
     * 参数代码（如aaa, bbbb等）
     */
    private String paramCode;

    /**
     * 参数名称（和paramCode相同）
     */
    private String paramName;

    /**
     * 参数描述（对应description）
     */
    private String paramDesc;

    /**
     * 参数类型：in_param-入参，out_param-出参
     */
    private String paramType;

    private Integer isRequired;
    /**
     * 数据类型（string, object, array等）
     */
    private String type;

    /**
     * 子类型（当type为array时，表示数组元素的类型）
     */
    private String subType;

    /**
     * 参数默认值（对应default）
     */
    private String paramDefault;

    /**
     * 子参数列表（当参数类型为object或array时，可能有子属性）
     */
    private List<ToolParam> children;

    /**
     * 术语信息（如果参数有extensions.x-term-info则存在）
     */
    private TermInfo termInfo;
}

