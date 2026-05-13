package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

@Data
@TableName("byai_aimodel")
public class AiModel implements Serializable {

    /**
     * 模型ID
     */
    @TableId
    private Long modelId;

    /**
     * 模型类型
     */
    private String modelType;

    /**
     * 模型名称
     */
    private String modelName;

    /**
     * 模型编号/标识
     */
    private String modelNo;

    /**
     * API地址
     */
    private String url;

    /**
     * 原始URL
     */
    private String oriUrl;

    /**
     * 认证令牌
     */
    private String authToken;

    /**
     * 状态
     */
    private String status;

    /**
     * 是否支持图表
     */
    private String isSupportChart;

    /**
     * 是否深度思考
     */
    private String isDeepthink;

    /**
     * 最大内容令牌数
     */
    private Integer maxContentToken;

    /**
     * 输入参数
     */
    private String inParams;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 创建时间
     */
    private Date createTime;
}
