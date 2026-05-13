package com.iwhalecloud.byai.manager.entity.men;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import java.util.Date;

/**
 * 待办任务接收对象表
 */
@Getter
@Setter
@TableName("men_task_rec_obj")
public class MenTaskRecObj {
    /** 主键标识 */
    @TableId(value = "task_rec_obj_id", type = IdType.INPUT)
    private Long taskRecObjId;

    /** 任务标识 */
    private Long taskId;

    /** 接收对象类型HUMAN、AGENT、ASSITENT */
    private String reciType;

    /** 接收对象标识 */
    private Long reciObjId;

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