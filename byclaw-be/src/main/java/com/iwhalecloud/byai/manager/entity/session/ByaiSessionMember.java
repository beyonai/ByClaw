package com.iwhalecloud.byai.manager.entity.session;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 会话成员表实体 对应表：byai_session_member
 * <p>
 * 说明：用于群聊功能，管理会话中的成员信息。字段类型使用通用 Java 类型，兼容 MySQL / Oracle / PostgreSQL。
 * </p>
 *
 * @author system
 */
@Getter
@Setter
@TableName("byai_session_member")
public class ByaiSessionMember {

    /**
     * 主键标识
     */
    @TableId(value = "byai_session_member_id", type = IdType.INPUT)
    private Long byaiSessionMemberId;

    /**
     * 会话标识
     */
    private Long sessionId;

    /**
     * 成员类型：AGENT-数字员工，USER-企业员工
     */
    private String memObjType;

    /**
     * 成员标识：数字员工标识或用户标识
     */
    private Long memObjId;

    /**
     * 成员角色：OWNER-群主，ADMIN-管理员，MEMBER-成员
     */
    private String userRole;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 创建人员
     */
    private Long creatorId;

    /**
     * 成员名称
     */
    private String memName;

    /**
     * 请求次数
     */
    private Long requestCount;

    /**
     * 所属企业
     */
    private Long comAcctId;
}
