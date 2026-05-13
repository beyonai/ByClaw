package com.iwhalecloud.byai.manager.entity.aimodel;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.io.Serializable;
import java.util.Date;
import lombok.Data;

/**
 * 模型定义表 byai_aimodel
 * 与接口文档 Model 对应，用于模型管理（列表/编辑/调试/启停/详情）
 *
 * @author system
 */
@Data
@TableName("byai_aimodel")
public class ByaiAimodel implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 模型ID */
    @TableId
    private Long modelId;

    /** 模型类型：LARGE_MODEL（大模型）、SMALL_MODEL（小模型），接口 modelType 如 LLM */
    private String modelType;

    /** 模型名称，如云雀大模型；接口 displayName */
    private String modelName;

    /** 模型编号，如 gpt3.5；接口 modelCode */
    private String modelNo;

    /** 模型地址；接口 apiEndpoint */
    private String url;

    /** 模型原始地址 */
    private String oriUrl;

    /** 模型认证票据；接口 apiToken，建议加密存储 */
    private String authToken;

    /** 状态：OOA（启用），OOX（停用/未启用），OOD（调试中）；接口 status ENABLED/DISABLED/TESTING */
    private String status;

    /** 是否支持图表：YES、NO */
    private String isSupportChart;

    /** 是否支持深度思考：YES、NO */
    private String isDeepthink;

    /** 字符串最大长度；接口 contextTokens */
    private Integer maxContentToken;

    /** 用于存储自定义入参（abilities、systems、headers、超时重试等 JSON） */
    private String inParams;

    /** 入参模板 */
    private String inparamTemplate;

    /** 创建人ID */
    private Long createBy;

    /** 创建时间（表仅有此时间字段；接口 updatedAt 可由 create_time 或 in_params 提供） */
    private Date createTime;


    /**
     * 1 是默认的， 0 是非默认的
     */
    @TableField(exist = false)
    private Integer isDefault;
}
