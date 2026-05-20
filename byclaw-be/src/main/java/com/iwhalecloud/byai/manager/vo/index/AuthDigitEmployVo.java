package com.iwhalecloud.byai.manager.vo.index;

import com.alibaba.fastjson.annotation.JSONField;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Date;
import lombok.Getter;
import lombok.Setter;

/**
 * 当前账号可用的数字员工信息视图对象。 对应授权数字员工查询返回的数据结构。
 */
@Getter
@Setter
public class AuthDigitEmployVo {

    /**
     * 智能体唯一标识。
     */
    private Long id;

    /**
     * 智能体名称。
     */
    private String name;

    /**
     * 智能体描述信息。
     */
    private String resourceDesc;

    /**
     * 资源编码。
     */
    private String resourceCode;

    /**
     * 资源归属类型：enterprise-企业，personal-个人。
     */
    private String ownerType;

    /**
     * 智能体类型。
     */
    private String agentType;

    /**
     * 首页地址
     */
    private String agentHomeUrl;

    /**
     * 智能体图标地址。
     */
    private String avatar;

    /**
     * 聊天场景使用的头像。
     */
    private String chatAvatar;

    /**
     * 置顶时间，格式yyyy-MM-dd HH:mm:ss。
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date topTime;

    /**
     * 终端类型：ALL全端、PC、APP等。
     */
    private String terminal;

    /**
     * 是否打开超级助手
     */
    private String openSuperHelper;

    /**
     * 数字员工开场信息
     */
    private String prologue;

    /**
     * 集成方式
     */
    private String integrationType;

    /**
     * 智能体开发类型：byai/bot/dify/whaleAgent
     */
    private String agentDevType;

    /**
     * 创建类型
     */
    private String createType;

    /**
     * 创建人ID
     */
    private Long creatorId;

    /**
     * 是否我创建的
     */
    private boolean myCreate;

    /**
     * 标签名称
     */
    private String tagName;

    /**
     * 是否为当前用户默认助理。
     */
    @JsonProperty("isDefault")
    private Boolean isDefault;

    /**
     * 是否允许当前用户将该数字员工设为默认助理。
     */
    private Boolean canSetDefault;

    /**
     * 优先返回订阅的授权类型
     */
    private String grantType;

    /**
     * 最新授权时间，格式yyyy-MM-dd HH:mm:ss。
     */
    @JSONField(format = "yyyy-MM-dd HH:mm:ss")
    private Date latestGrantTime;

    /**
     * 是否置顶：1-是，0-否。
     */
    private Integer isTop = 0;

    /**
     * 是否有记忆：true-有记忆，false-无记忆
     */
    private Boolean hasMemory;

    /**
     * 知识数量总和 (KG_DOC + KG_QA + KG_TERM)
     */
    private Integer knowledgeCount;

    /**
     * 技能数量总和 (AGENT + MCP + TOOLKIT + TOOL)
     */
    private Integer skillsCount;
}
