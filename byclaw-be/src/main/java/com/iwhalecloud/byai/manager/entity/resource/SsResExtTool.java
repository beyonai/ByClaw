package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.io.Serializable;

/**
 * 插件工具扩展表实体类
 */
@Data
@TableName("ss_res_ext_tool")
public class SsResExtTool {

    /**
     * 数字资源标识
     */
    @TableId
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * path的参数
     */
    private String pathSchema;

    /**
     * query的参数
     */
    private String querySchema;

    /**
     * 调用方法get/post/put/delete
     */
    private String method;

    /**
     * 工具入参, 标准的JSON Schema
     */
    private String inputSchema;

    /**
     * 工具出参, 标准的JSON Schema
     */
    private String outputSchema;

    /**
     * 地址
     */
    private String url;

    /**
     * 地址原始地址
     */
    private String urlOri;

    /**
     * 工具添加方式，如 json
     */
    @TableField("tool_add_type")
    private String toolAddType;

    /**
     * 源 JSON 内容
     */
    @TableField("source_content")
    private String sourceContent;

    /**
     * 目标 JSON 内容
     */
    @TableField("target_content")
    private String targetContent;

}

