package com.iwhalecloud.byai.manager.dto.notification;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * 通知管理请求 DTO
 */
@Data
public class NotificationManageDto implements Serializable {

    private static final long serialVersionUID = 1L;

    @JsonSerialize(using = ToStringSerializer.class)
    private Long id;

    /** 通知标题 */
    private String title;

    /** 通知内容 */
    private String content;

    /** 通知类型：0-系统通知 1-业务通知 2-版本通知 */
    private Short bizType;

    /** 优先级：1-低，2-中，3-高，4-紧急 */
    private Short priority;

    /** 过期时间 */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date expireTime;

    /** 扩展信息，版本通知用于保存版本号 */
    private String extraInfo;
}
