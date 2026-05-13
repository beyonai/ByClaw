package com.iwhalecloud.byai.manager.entity.datacloud;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * 目标脚本表实体类
 * 用于管理录制的脚本的目标选择器脚本
 * 
 * @author system
 * @date 2025-01-15
 */
@Data
@TableName("datacloud_target_script")
public class DatacloudTargetScript implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 目标脚本主键ID
     */
    @TableId(type = IdType.INPUT)
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = Mod.class, message = "{datacloud.target.script.id.notnull}")
    private Long targetScriptId;

    /**
     * 关联脚本ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.target.script.script.id.notnull}")
    private Long scriptId;

    /**
     * Python脚本内容
     */
    private String pyScriptContent;

    /**
     * NodeJS脚本内容
     */
    private String nodeScriptContent;

     /**
     * 元数据信息（JSON格式）
     */
    private String metaInfos;

    /**
     * 目标选择器
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.target.script.selector.notblank}")
    private String targetSelector;

    /**
     * 目标选择器的类型
     */
    @NotBlank(groups = {Add.class, Mod.class}, message = "{datacloud.target.script.type.notblank}")
    @Size(groups = {Add.class, Mod.class}, max = 50, message = "{datacloud.target.script.type.size}")
    private String type;

    /**
     * 扩展参数（JSON格式）
     */
    private String extParams;

    /**
     * 下一页选择器
     */
    private String nextPageSelector;

    /**
     * 最大翻页数
     */
    private String maxPages;

    /**
     * 目标顺序
     */
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.target.script.order.notnull}")
    private Integer targetOrder;

    /**
     * 企业ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.target.script.enterprise.notnull}")
    private Long enterpriseId;

    /**
     * 创建人ID
     */
    @JsonSerialize(using = ToStringSerializer.class)
    @NotNull(groups = {Add.class, Mod.class}, message = "{datacloud.target.script.creator.notnull}")
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
