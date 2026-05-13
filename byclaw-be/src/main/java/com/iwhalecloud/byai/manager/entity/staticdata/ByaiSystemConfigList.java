package com.iwhalecloud.byai.manager.entity.staticdata;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

/**
 * 系统配置列表实体类
 * 对应表：byai_system_config_list
 */
@Getter
@Setter
@TableName("byai_system_config_list")
public class ByaiSystemConfigList {

    /**
     * 参数ID
     */
    @TableId(value = "param_id", type = IdType.INPUT)
    private Long paramId;

    /**
     * 分组编码
     */
    private String paramGroupCode;

    /**
     * 分组名称
     */
    private String paramGroupName;

    /**
     * 参数名称
     */
    private String paramName;

    /**
     * 参数英文名称
     */
    private String paramEnName;

    /**
     * 静态参数值
     */
    private String paramValue;

    /**
     * 静态参数描述
     */
    private String paramDesc;

    /**
     * 参数排序
     */
    private Integer paramSeq;

}

