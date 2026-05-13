package com.iwhalecloud.byai.manager.dto.scheduletask;

import java.util.List;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

/**
 * 定时任务更新请求
 *
 * @author zzh
 * 2025-11-21
 */
@Setter
@Getter
public class ScheduleTaskUpdateRequest {

    /**
     * 任务ID，主键
     */
    @NotNull(message = "任务ID不能为空")
    private Long taskId;

    /**
     * 任务名称，由内容总结生成
     */
    @Size(max = 50, message = "任务名称长度不能超过50字符")
    private String taskName;

    /**
     * 关联资源id，数字员工id或者智能体id
     */
    private Long resourceId;

    /**
     * 任务状态：00A、00X
     */
    @Pattern(regexp = "00A|00X", message = "任务状态不合法，仅支持00A或00X")
    private String statusCd;

    /**
     * 执行周期：DAY（每天）、WEEK（每周）、MONTH（每月）、CUSTOM（固定时间）
     */
    @Pattern(regexp = "DAY|WEEK|MONTH|CUSTOM", message = "执行周期不合法，仅支持DAY、WEEK、MONTH、CUSTOM")
    private String executionCycle;

    /**
     * 执行频率：每周几或者每月几号，选每日和固定时间是为空
     * <ul>
     *   <li>当 executionCycle = WEEK 时：必须是星期英文常量数组（MONDAY、TUESDAY等）</li>
     *   <li>当 executionCycle = MONTH 时：必须是 1-31 的字符串数组（每月几号）</li>
     *   <li>当 executionCycle = DAY 或 CUSTOM 时：必须为空</li>
     * </ul>
     * <p>前端传递数组，后端会拼接成字符串存储，格式：MONDAY,TUESDAY,WEDNESDAY 或 1,2,3</p>
     */
    private List<String> executionFrequency;

    /**
     * 执行时间，HH:mm:ss
     */
    @Pattern(regexp = "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$", message = "执行时间格式不正确，应为HH:mm:ss")
    private String executionTime;

    /**
     * 执行任务内容，调用参数
     */
    private String executionContent;
}

