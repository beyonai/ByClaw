package com.iwhalecloud.byai.manager.dto.notification;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * @author zht
 * @version 1.0
 * @date 2025/10/16
 */
@Data
public class NotificationDto implements Serializable {
    private static final long serialVersionUID = 1L;

    /** 通知标题 */
    private String title;

    /** 通知内容 */
    private String content;

    /** 通知类型�?-系统通知 1-业务通知 */
    private Short bizType;

    /** 优先�?1-�?2-�?3-�?4-紧�? */
    private Short priority;

    /** 智能体类�? */
    private String resourceBizType;

    /** 智能体id */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /** 发送者id(创建�? */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long senderId;

    /** 接收者id(修改�? */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long targetId;

    /** 过期时间 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date expireTime;

    /** 扩展信息，JSON结构 */
    private String extraInfo;
}
