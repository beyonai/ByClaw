package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 资源扩展属性表实体类
 */
@Getter
@Setter
@TableName("ss_res_ext_attribute")
public class SsResExtAttribute {

    /**
     * 动作属性标识（主键）
     */
    @TableId(value = "ext_attribute_id", type = IdType.AUTO)
    @JsonSerialize(using = ToStringSerializer.class)
    private Long extAttributeId;

    /**
     * 动作资源标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 对象ID（函数关联的对象resourceId）
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long objId;

    /**
     * 枚举：in_param:入参，out_param: 出参,  script: 脚本，basic:基本属性，promt：提示词
     */
    private String attributeType;

    /**
     * 属性编码
     */
    private String attributeCode;

    /**
     * 参数值
     */
    private String attributeValue;

    /**
     * 枚举：String、Integer 、Number、Array 、Object、Enum
     */
    private String type;

    /**
     * 属性值正则校验规则
     */
    private String formatExpSt;

    /**
     * 例如：元，万
     */
    private String unit;

    /**
     * 是否必填(@0 否；@1 是)
     */
    private Integer isRequired;

    /**
     * 关联的术语类型编码
     */
    private String termTypeCode;

    /**
     * 关联术语字段：枚举值：id/name
     */
    private String termField;

    /**
     * 属性描述
     */
    private String attributeDesc;

    /**
     * 动作参数样例：
     * {
     * "rel_obj_id": "",//关联对象id
     * "rel_obj_attribute_id": "",//关联对象属性id
     * "action_xpath": "", //在动作的参数路径
     * "rel_plugin_resouceid": "", //关联工具id
     * "rel_tool_resouceid": "", //关联工具id
     * "rel_tool_param_xpath": //关联工具参数,一级是：path_param/query_param/input/output, 二级以后是：参数的xpath,例如：path_param.result.data[].name
     * }
     * 
     * 对象参数示例：
     * {
     * "is_biz_id": "是否业务主键" //业务主键(@0 否；@1 是),
     * "is_obj_id": "是否对象主键" //业务主键(@0 否；@1 是),
     * "is_obj_name": "是否对象名称" //业务主键(@0 否；@1 是)
     * }
     */
    private String extMeta;

    /**
     * 排序
     */
    private Integer sort;

}

