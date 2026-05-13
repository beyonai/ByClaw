package com.iwhalecloud.byai.manager.dto.scheduletask;

import java.util.List;

import com.iwhalecloud.byai.manager.entity.scheduletask.ScheduleTask;

import lombok.Getter;
import lombok.Setter;

/**
 * 定时任务更新请求
 *
 * @author zzh 2025-11-21
 */
@Setter
@Getter
public class ScheduleTaskDto extends ScheduleTask {

    private List<String> executionFrequencys;

}
