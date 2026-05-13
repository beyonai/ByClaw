package com.iwhalecloud.byai.manager.vo.scheduletask;

import java.util.List;

import com.iwhalecloud.byai.manager.entity.scheduletask.ScheduleTask;
import lombok.Getter;
import lombok.Setter;

/**
 * zzh 2025/11/24 11:31:26
 */
@Getter
@Setter
public class ScheduleTaskVo extends ScheduleTask {

    /**
     * 资源名称
     */
    private String resourceName;

    /**
     * 执行用户名称
     */
    private String executorName;

    /**
     * 执行任务
     */
    private List<String> executionFrequencys;

}
