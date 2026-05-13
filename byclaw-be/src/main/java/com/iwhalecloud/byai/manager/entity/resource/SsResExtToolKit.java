package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.io.Serializable;

/**
 * 插件扩展表实体类
 */
@Data
@TableName("ss_res_ext_toolkit")
public class SsResExtToolKit implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 数字资源标识
     */
    @TableId
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 认证信息
     */
    private String headers;

    /**
     * 原始 JSON 内容
     */
    private String sourceContent;

    /**
     * 增加 resourceId 首节点后的 JSON 内容
     */
    private String targetContent;
}
