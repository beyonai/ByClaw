package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;
import java.io.Serializable;
import java.util.Date;

/**
 * 资源版本表实体类
 */
@Data
@TableName("ss_resource_version")
public class SsResourceVersion implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 版本标识
     */
    @TableId(type = IdType.INPUT)
    private Long resourceVersionId;

    /**
     * 资源标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 外系统编码，BYAI：百应，WHAGE_AGENT:老智能体，BOT：博特，DIFY：DIFY
     */
    private String systemCode;

    /**
     * 存放智能体平台或BOT的resourceId
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceSourcePkId;

    /**
     * 资源类型，AGENT-智能体，DOC-文档库 PLGIN-插件 DB-数据库，MCP-MCP服务，TOOL- 工具，MCP_TOOL:MCP工具
     */
    private String resourceBizType;

    /**
     * ATOM：原子资源/COMBIN：组合资源
     */
    private String resourceType;

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 资源描述
     */
    private String resourceDesc;

    /**
     * 资源图标：前端提供的枚举值
     */
    private String avatar;

    /**
     * 常见问题
     */
    private String sample;

    /**
     * 标签:用于关键字检索匹配
     */
    private String tags;

    /**
     * 版本号,例如1.0
     */
    private String versionNo;

    /**
     * 所属目录ID
     */
    private Long catalogId;

    /**
     * 归属组织
     */
    private Long manOrgId;

    /**
     * 授权管理员（支持多个用户ID，用逗号分隔）
     */
    private String manUserId;

    /**
     * 索引清单
     */
    private String indexList;

    /**
     * 资源发布人，一般填写资源的开发人员，用于做日志记录
     */
    private String publisher;

    /**
     * 扩展信息，使用JSON存储关联各种类型扩展表
     */
    private String extInfo;

    /**
     * 关联资源信息,使用数组存储,[1,2,3,4]
     */
    private String relResourceList;

    /**
     * 资源状态
     */
    private Integer resourceStatus;

    /**
     * 1：历史版本，2：中间版本，3：在用版本
     */
    private Integer versionStatus;

    /**
     * 创建人
     */
    private Long createBy;

    /**
     * 创建时间
     */
    private Date createTime;

    /**
     * 更新人
     */
    private Long updateBy;

    /**
     * 更新时间
     */
    private Date updateTime;

    /**
     * 所属企业
     */
    private Long comAcctId;
}

