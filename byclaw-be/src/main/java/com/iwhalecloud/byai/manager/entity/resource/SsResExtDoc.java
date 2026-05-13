package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;
import java.io.Serializable;

/**
 * 文档库扩展表实体类
 */
@Data
@TableName("ss_res_ext_doc")
public class SsResExtDoc implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 数字资源标识
     */
    @TableId
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 存放智能体的resourceId
     */
    private Long resourceAgentId;

    private String type;

    private Long pluginMachineId;

    private String kdbId;

    private String resourceCatalogSub;

    private String sourceContent;

    private String targetContent;

}
