package com.iwhalecloud.byai.manager.entity.datacloud;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/10/11 17:25
 */
@Data
@TableName("datacloud_script_view")
public class DataCloudScriptView implements Serializable {

    private static final long serialVersionUID = 1L;

     /**
      * 视图ID
      */
     @TableId(type = IdType.INPUT)
     @JsonSerialize(using = ToStringSerializer.class)
     private Long viewId;


    /**
     * 视图名称
     */
    private String viewName;

    /**
     * 视图描述
     */
    private String viewDescription;

    /**
     * 绑定的MCP服务资源ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 关联插件引擎的资源对象ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long relObjId;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceProjectId;

    /**
     * 发布状态
     * @0 未发布
     * @1 已发布
     */
    private Integer publishStatus;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.script.step.creator.notnull}")
    private Long creatorId;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 更新者ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long updateBy;

    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;
}
