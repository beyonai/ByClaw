package com.iwhalecloud.byai.manager.entity.conversation;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import lombok.Data;

import java.util.Date;

/**
 * @author cxf
 * @description: 反馈处理信息
 * @date 2025/9/9 09:35
 */
@Data
@TableName("feedback_msg_info")
public class FeedbackMsgInfo {
    /**
     * 主键标识
     */
    @TableId(value = "feedback_msg_id", type = IdType.INPUT)
    private Long feedbackMsgId;

    /**
     * 创建时间，默认值为当前系统时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    /**
     * 创建用户
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long createUser;

    /**
     * 是否处理 0-未处理 1-已处理 默认已处理1
     */
    private Integer isHandle = 1;

    /**
     * 是否指派用户 0-未指派 1-已指派 默认未指派0
     */
    private Integer isAssign = 0;

    /**
     * 指派用户
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long assignUser;

    /**
     * 处理人
     */
    @JsonSerialize(using = ToStringSerializer.class)
    private Long handleUser;

    /**
     * 处理时间，默认值为当前系统时间
     */
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date handleTime;


}
