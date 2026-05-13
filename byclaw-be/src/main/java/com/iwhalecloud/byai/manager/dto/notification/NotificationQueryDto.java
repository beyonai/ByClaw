package com.iwhalecloud.byai.manager.dto.notification;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;
import java.util.List;

/**
 * 通知查询DTO
 */
@Data
public class NotificationQueryDto implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 页码
     */
    private Integer pageNum = 1;

    /**
     * 每页大小
     */
    private Integer pageSize = 10;

    /** 通知标题 */
    private String title;

    /** 通知内容 */
    private String content;

    /** 通知类型：0-系统通知 1-业务通知 */
    private Short bizType;

    /** 优先级：1-低，2-中，3-高，4-紧急 */
    private Short priority;

    /** 是否已读：1是，0否，默认0 */
    private String isRead;

    /** 智能体类型 */
    private String resourceBizType;

    /** 智能体id */
    private List<Long> resourceIdList;

    /** 接收者id(修改人) */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long targetId;

    /** 创建开始时间 */
    private String createStartTime;

    /** 创建结束时间 */
    private String createEndTime;
    
    /** 生成时间(创建时间) */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /** 阅读时间(修改时间) */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date readTime;

    /** 阅读开始时间 */
    private String readStartTime;

    /** 阅读结束时间 */
    private String readEndTime;

}