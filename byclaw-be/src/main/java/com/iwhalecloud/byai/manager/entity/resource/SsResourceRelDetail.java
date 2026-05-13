package com.iwhalecloud.byai.manager.entity.resource;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

/**
 * 资源关联明细表实体类
 */
@Data
@TableName("ss_resource_rel_detail")
public class SsResourceRelDetail implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 关联关系明细ID
     */
    @TableId(type = IdType.INPUT)
    private Long resourceRelDetailId;

    /**
     * 资源来源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 关联资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long relResourceId;

    /**
     * 关联子资源的信息
     */
     private String relResourceInfo;

    /**
     * 创建人ID
     */
    private Long createBy;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新人ID
     */
    private Long updateBy;

    /**
     * 更新时间
     */
    private Date updateTime;

    /**
     * 所属企业ID
     */
    private Long comAcctId;

    /**
     * 关联类型名称（主从关系ID，格式：主id:从id）
     */
    private String relTypeName;

    /**
     * 关联状态（1-开启，0-关闭）
     */
    private Integer relStatus;

}

