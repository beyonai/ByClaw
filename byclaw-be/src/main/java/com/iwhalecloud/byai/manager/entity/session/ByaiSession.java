package com.iwhalecloud.byai.manager.entity.session;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;
import java.util.Date;

/**
 * 会话主表实体 对应表：byai.byai_session
 * <p>
 * 说明：字段类型使用通用 Java 类型，兼容 MySQL / Oracle / PostgreSQL。
 * </p>
 */
@Data
@TableName("byai_session")
public class ByaiSession {

    /**
     * 会话主键
     */
    @TableId(value = "session_id", type = IdType.INPUT)
    private Long sessionId;

    /**
     * 父会话主键
     */
    private Long parentSessionId;

    /**
     * 会话名称
     */
    private String sessionName;

    /**
     * 创建时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 创建人标识
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long creatorId;

    /**
     * 关联对象类型
     */
    private String objectType;

    /**
     * 关联对象主键
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long objectId;

    /**
     * 企业主键
     */
    private Long enterpriseId;

    /**
     * 会话内容摘要或说明
     */
    private String sessionContent;

    /**
     * 是否调试会话：0-否 1-是
     */
    private Integer isDebug;

    /**
     * 会话类型
     */
    private String sessionType;

    /**
     * 更新人标识
     */
    private Long updateBy;

    /**
     * 更新时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;

    /**
     * 会话状态信息(JSON 或文本)
     */
    private String state;
}
