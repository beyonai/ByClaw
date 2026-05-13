package com.iwhalecloud.byai.manager.qo.scheduletask;

import lombok.Getter;
import lombok.Setter;

/**
 * 定时任务查询参数
 *
 * @author zzh
 * 2025-11-21
 */
@Setter
@Getter
public class ScheduleTaskQo {

    /**
     * 关联资源id，数字员工id或者智能体id
     */
    private Long resourceId;

    /**
     * 执行用户id，前台默认是当前用户
     */
    private Long executorId;
}

