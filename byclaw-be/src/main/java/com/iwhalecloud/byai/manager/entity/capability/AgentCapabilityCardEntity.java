package com.iwhalecloud.byai.manager.entity.capability;

import java.io.Serial;
import java.io.Serializable;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;

import lombok.Getter;
import lombok.Setter;

/**
 * Agent 能力卡快照；复用 byclaw-super 的 byai_super_agent_capability_cards 表，
 * 仅保存编译产物，权限关系不进入此表。
 *
 * <p>唯一键为 (systemCode, agentId) 复合主键，无独立 id 列；故不使用 MyBatis-Plus 主键注解。</p>
 *
 * @author tangs
 */
@Getter
@Setter
@TableName("byai.byai_super_agent_capability_cards")
public class AgentCapabilityCardEntity implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    private String systemCode;

    private String agentId;

    private String agentCode;

    private String agentName;

    private String schemaVersion;

    private String generatorVersion;

    private String sourceVersion;

    private String sourceFingerprint;

    /**
     * 能力卡正文 JSON。
     */
    private String card;

    /**
     * 供路由器使用的平铺文本。
     */
    private String routingText;

    /**
     * 质量评估 JSON。
     */
    private String quality;

    private String status;

    private Integer version;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createdAt;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updatedAt;
}
