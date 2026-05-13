package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.io.Serializable;

/**
 * add by qin.guoquan 2026-04-10
 * 对象扩展表实体类
 */
@Data
@TableName("ss_res_ext_object")
public class SsResExtObject implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    @TableField("mcp_server_url")
    private String mcpServerUrl;

    @TableField("mcp_transfer_type")
    private String mcpTransferType;

    @TableField("source_content")
    private String sourceContent;

    @TableField("target_content")
    private String targetContent;
}
