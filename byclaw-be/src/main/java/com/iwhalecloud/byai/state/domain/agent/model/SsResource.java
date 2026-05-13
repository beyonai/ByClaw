package com.iwhalecloud.byai.state.domain.agent.model;

import java.io.Serializable;
import java.util.Date;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SsResource implements Serializable {

    private static final long serialVersionUID = 1L;

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
     * 资源类型，AGENT-智能体，DOC-文档库 PLGIN-插件 DB-数据库，MCP-MCP服务，TOOL- 工具，MCP_TOOL:MCP工具 .DB_DATASET 数据集
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
     * 引用资源版本
     */
    private String resourceVersionId;

    /**
     * 服务模式:hosted:远程，local:本地
     */
    private String hostType;

    /**
     * 所属目录ID
     */
    private Long catalogId;

    /**
     * 归属组织
     */
    private Long manOrgId;

    /**
     * 授权管理员
     */
    private String manUserId;

    /**
     * 索引清单
     */
    private String indexList;

    /**
     * 创建人
     */
    private String createBy;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
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

    /**
     * 资源状态
     */
    private Integer resourceStatus;

    /**
     * 草稿版本号
     */
    private Long resourceDVerid;

    /**
     * 正式版本号
     */
    private Long resourceRVerid;

    /**
     * 资源编码
     */
    private String resourceCode;

    /**
     * 分享范围 1 (SHARE_PRIVATE): 仅我可见 - 私有资源 2 (SHARE_RESTRICT): 部分可见 - 限制性分享 3 (SHARE_PUBLIC): 全公司可见 - 公开资源
     */
    private Integer shareRange;

    /**
     * 资源实现方式
     */
    private String implType;

    /**
     * 资源对应Agent的在Worker中的注册类型
     */
    private String workerAgentType;

    private String manOrgName;

    private String createUserName;

    private String manUserName;

    /**
     * 是否置顶 1:置顶 0:不置顶
     */
    private Integer isTop;

    /**
     * 置顶时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date topTime;

}
