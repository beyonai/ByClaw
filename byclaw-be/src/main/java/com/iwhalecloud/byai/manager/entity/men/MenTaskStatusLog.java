package com.iwhalecloud.byai.manager.entity.men;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * 待办任务状态变更表
 */
@Getter
@Setter
@TableName("men_task_status_log")
public class MenTaskStatusLog {

    /** 主键标识 */
    @TableId(value = "task_status_log_id", type = IdType.INPUT)
    private Long taskStatusLogId;

    /** 任务标识 */
    private Long taskId;

    /** 上一个待办的任务状态 */
    private String statusCdOld;

    /** 当前任务状态和待办任务状态一致 */
    private String statusCd;

    /** 关联消息标识 */
    private Long messageId;

    /** 关联消息步骤标识 */
    private String messageStepCode;

    /** 变更描述审批的时候输入的描述 */
    private String changDesc;

    /** 创建人 */
    private Long createBy;

    /** 创建时间 */
    private Date createTime;

    /** 更新人 */
    private Long updateBy;

    /** 更新时间 */
    private Date updateTime;

    /** 所属企业 */
    private Long comAcctId;
}