package com.iwhalecloud.byai.common.feign.response.python;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 批处理进度响应
 */
@Getter
@Setter
public class BatchProgressResponse {

    /**
     * 批次ID
     */
    private String batch_id;

    /**
     * 总任务数
     */
    private int total_tasks;

    /**
     * 已完成任务数
     */
    private int completed_tasks;

    /**
     * 运行中任务数
     */
    private int running_tasks;

    /**
     * 失败任务数
     */
    private int failed_tasks;

    /**
     * 待处理任务数
     */
    private int pending_tasks;

    /**
     * 准确率
     */
    private double accuracy;

    /**
     * 进度百分比
     */
    private double progress_percentage;

    /**
     * 状态
     */
    private String status;

    /**
     * 创建时间
     */
    private String created_at;

    /**
     * 更新时间
     */
    private String updated_at;

    /**
     * 任务列表
     */
    private List<Task> tasks;

    /**
     * detail 信息
     */
    private Object detail;

    /**
     * 任务详情
     */
    @Getter
    @Setter
    public static class Task {

        /**
         * 任务ID
         */
        private int task_id;

        /**
         * 批次ID
         */
        private String batch_id;

        /**
         * 工作表名称
         */
        private String sheet_name;

        /**
         * 状态
         */
        private String status;

        /**
         * 创建时间
         */
        private String created_at;

        /**
         * 更新时间
         */
        private String updated_at;

        /**
         * 错误信息
         */
        private String error;

        /**
         * 结果
         */
        private Result result;

        /**
         * 摘要
         */
        private Summary summary;
    }

    /**
     * 任务结果
     */
    @Getter
    @Setter
    public static class Result {

        /**
         * 额外属性
         */
        private Object additionalProp1;
    }

    /**
     * 任务摘要
     */
    @Getter
    @Setter
    public static class Summary {

        /**
         * 额外属性
         */
        private Object additionalProp1;
    }
}