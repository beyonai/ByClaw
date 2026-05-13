package com.iwhalecloud.byai.manager.entity.superassist;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

@Getter
@Setter
@TableName("Suas_Superassist_Sub_Agent")
public class SuasSuperassistSubAgent {

    /**
     * 超级助手子智能体关联ID 该字段是主键，用于唯一标识超级助手与子智能体的关联关系记录。 数据库字段：suas_superassist_sub_agent.superassist_sub_agent_id
     *
     * @mbggenerated
     */
    @TableId(value = "superassist_sub_agent_id", type = IdType.INPUT)
    private Long superassistSubAgentId;

    /**
     * 超级助手ID 该字段表示超级助手的唯一标识，用于关联具体的超级助手用户。 数据库字段：suas_superassist_sub_agent.superassist_id
     *
     * @mbggenerated
     */
    private Long superassistId;

    /**
     * 智能体ID 该字段表示可使用的数字资源的唯一标识。 数据库字段：suas_superassist_sub_agent.agent_id
     *
     * @mbggenerated
     */
    private Long agentId;

    /**
     * 数字资源类型 该字段表示数字资源的类型，如智能体、文档库等。 数据库字段：suas_superassist_sub_agent.agent_type
     *
     * @mbggenerated
     */
    private String agentType;

    /**
     * 状态码 该字段表示授权状态：A-有效，X-无效。 数据库字段：suas_superassist_sub_agent.status_cd
     *
     * @mbggenerated
     */
    private String statusCd;

    /**
     * 是否订阅 该字段表示是否订阅：1是，0否，默认0。 数据库字段：suas_superassist_sub_agent.is_sub
     *
     * @mbggenerated
     */
    private Integer isSub;

    /**
     * 订阅时间 该字段记录订阅时间。 数据库字段：suas_superassist_sub_agent.sub_time
     *
     * @mbggenerated
     */
    private Date subTime;

    /**
     * 是否置顶 该字段表示是否置顶：1是，0否，默认0。 数据库字段：suas_superassist_sub_agent.is_top
     *
     * @mbggenerated
     */
    private Integer isTop;

    /**
     * 置顶时间 该字段记录置顶时间。 数据库字段：suas_superassist_sub_agent.top_time
     *
     * @mbggenerated
     */
    private Date topTime;

    /**
     * 创建人ID 该字段记录创建此关联关系的用户ID，用于审计和追踪。 数据库字段：suas_superassist_sub_agent.create_by
     *
     * @mbggenerated
     */
    private Long createBy;

    /**
     * 更新人ID 该字段记录最后更新此关联关系的用户ID，用于审计和追踪。 数据库字段：suas_superassist_sub_agent.update_by
     *
     * @mbggenerated
     */
    private Long updateBy;

    /**
     * 更新时间 该字段记录此关联关系的最后更新时间，用于数据同步和审计。 数据库字段：suas_superassist_sub_agent.update_date
     *
     * @mbggenerated
     */
    private Date updateDate;

    /**
     * 企业账户ID 该字段表示所属的企业账户ID，用于多租户隔离和数据权限控制。 数据库字段：suas_superassist_sub_agent.com_acct_id
     *
     * @mbggenerated
     */
    private Long comAcctId;

    /**
     * 创建时间 该字段记录此关联关系的创建时间，用于数据审计和业务分析。 数据库字段：suas_superassist_sub_agent.create_time
     *
     * @mbggenerated
     */
    private Date createTime;

}
