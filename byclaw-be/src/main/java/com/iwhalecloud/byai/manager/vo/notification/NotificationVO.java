package com.iwhalecloud.byai.manager.vo.notification;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.util.Date;
@Data
public class NotificationVO {

    @JsonSerialize(using = ToStringSerializer.class)
    private Long id;
    /** 通知标题 */
    private String title;

    /** 通知内容 */
    private String content;

    /** 通知类型-系统通知 1-业务通知 */
    private Short bizType;

    /** 优先级：1-低，2-中，3-高，4-紧急*/
    private Short priority;

    /** 是否已读：1是，0否，默认0 */
    private String isRead;

    /** 智能体类型*/
    private String resourceBizType;

    /** 智能体id */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /** 是否删除：1是，0否，默认0 */
    private String isDeleted;

    /** 发送者id(创建人) */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long senderId;

    /** 接收者id(修改人) */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long targetId;

    /** 生成时间(创建时间) */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /** 阅读时间(修改时间) */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date readTime;

    /** 过期时间 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date expireTime;

    /** 扩展信息，JSON结构 */
    private String extraInfo;
}
