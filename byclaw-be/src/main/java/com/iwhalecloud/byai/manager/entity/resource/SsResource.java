package com.iwhalecloud.byai.manager.entity.resource;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Getter;
import lombok.Setter;
import org.apache.commons.lang3.StringUtils;

@Getter
@Setter
@TableName("ss_resource")
public class SsResource implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /**
     * 资源标识
     */
    @TableId(type = IdType.INPUT)
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
     * 资源类型:DIG_EMPLOYEE-数字员工,AGENT-智能体，DOC-文档库 PLGIN-插件 DB-数据库，MCP-MCP服务，TOOL-
     * 工具，MCP_TOOL:MCP工具,TOOLKIT-插件,KG_DOC-文档知识库,KG_DB-数据知识库,KG_DB-术语知识库
     */
    private String resourceBizType;

    /**
     * ATOM：原子资源,COMBIN：组合资源
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
     * 授权管理员（支持多个用户ID，用逗号分隔）
     */
    private String manUserId;

    /**
     * 索引清单
     */
    private String indexList;

    /**
     * 创建人
     */
    private Long createBy;

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
     * 发布时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date publishTime;

    /**
     * 上架时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date shelfTime;

    /**
     * 下架时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private Date unshelfTime;

    /**
     * 授权状态
     */
    private String authStatus;

    /**
     * 是否发布到业务门户：1-是，0-否
     */
    private Integer publishPortal;

    /**
     * 父级资源标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long parentResourceId;

    /**
     * 资源发布类型,publish:公开审核,private:个有私有
     */
    private String publishType;

    /**
     * 资源归属类型：enterprise-企业，personal-个人,personal_default-默认资源(默认知识库)
     */
    private String ownerType;

    /**
     * 资源实现方式
     * 1.resourceBizType=AGENT:
     *  1.1. 默认问答型: implType = ASK_AGENT,workerAgentType = BYCLAW_EXE
     *  1.2. 个人问答型: implType = ASK_PERSONAL, workerAgentType = BYCLAW_EXE
     *  1.3. API调用时: implType = API, workerAgentType = NONE
     *  1.4. SSE调用时: implType = SSE, workerAgentType = NONE
     *
     * 2.resourceBizType=MCP：
     *  2.1. MCP调用时: implType = API, workerAgentType = NONE
     *
     * 3.resourceBizType=TOOLKIT：
     *  3.1. MCP调用时: implType = API, workerAgentType = NONE
     *
     * 4.resourceBizType=VIEW | OBJECT:
     *  4.1. 对象、视图调用时：implType = ASK_AGENT, workerAgentType = BYCLAW_DATA
     *
     * 5.resourceBizType=KG_*（KG_DOC | KG_DB | KG_TERM | KG_QA）:
     *  5.1. 知识调用时: implType = ASK_AGENT, workerAgentType = BYCLAW_QA
     *
     * 6.resourceBizType=DIG_EMPLOYEE：
     *  6.1. 代码类: implType = ASK_AGENT, workerAgentType = BYCLAW_CODE
     *  6.2. 综合类: implType = ASK_AGENT, workerAgentType = BYCLAW_EXE
     *  6.3. 问答类: implType = ASK_AGENT, workerAgentType = BYCLAW_DATA
     *  6.4. 问数类: implType = ASK_AGENT, workerAgentType = BYCLAW_QA
     *  6.5. 调试类：implType = ASK_AGENT, workerAgentType = DEBUG_{resourceId}
     */
    @TableField("impl_type")
    private String implType = "";

    /**
     * 资源对应Agent的在Worker中的注册类型
     */
    @TableField("worker_agent_type")
    private String workerAgentType = "";

    /**
     * 设置资源实现方式，前端未传值时统一按空字符串落库，避免主表出现 null。
     * @author qin.guoquan
     * @date 2026-04-25 14:30:00
     */
    public void setImplType(String implType) {
        this.implType = StringUtils.defaultString(implType);
    }

    /**
     * 设置资源对应 Agent 的 Worker 注册类型，前端未传值时统一按空字符串落库。
     * @author qin.guoquan
     * @date 2026-04-25 14:30:00
     */
    public void setWorkerAgentType(String workerAgentType) {
        this.workerAgentType = StringUtils.defaultString(workerAgentType);
    }

}
