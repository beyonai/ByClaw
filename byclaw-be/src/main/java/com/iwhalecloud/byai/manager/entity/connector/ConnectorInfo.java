package com.iwhalecloud.byai.manager.entity.connector;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 连接器基础元信息（平台连接器模板）。
 */
@Getter
@Setter
@TableName("byai_connector_info")
public class ConnectorInfo {

    /** 主键，业务层生成 */
    @TableId(value = "connector_id", type = IdType.INPUT)
    private Long connectorId;

    /** 连接器业务编码，全局唯一 */
    private String connectorCode;

    /** 连接器展示名称 */
    private String connectorName;

    /** 连接器图标地址 */
    private String iconUrl;

    /** 连接器功能简介 */
    private String description;

    /** 连接器类型：SYSTEM=系统内置，CUSTOM=自定义连接器 */
    private String connectorType;

    /** 授权方式：NONE、OAUTH2、AK_SK、PASSWORD、TOKEN，允许为空 */
    private String authMode;

    /** 连接器通用授权模板配置，JSON字符串 */
    private String authConfig;

    /** 连接器公共请求配置，JSON字符串 */
    private String requestConfig;

    /** 前端页面排序权重 */
    private Integer sort;

    /** 状态编码：00A=有效，00X=无效 */
    private String statusCd;

    /** 创建人标识 */
    private String createBy;

    /** 创建时间，新增自动填充 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date createTime;

    /** 更新时间，新增不赋值为NULL，更新时手动填充 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date updateTime;
}
