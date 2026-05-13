package com.iwhalecloud.byai.common.feign.response.conversation;

import lombok.Data;

import java.io.Serializable;
import java.util.Date;
import java.util.List;

@Data
public class TodoQueryRespDTO implements Serializable {

    /** 是否存在待办任务 */
    private Boolean hasTasks;

    /** 任务总数 */
    private Integer totalCount;

    /** 按状态分组的任务数量 */
    private TaskStatusCount statusCount;

    /** 任务列表（可选，用于详细查询�?*/
    private List<TaskInfo> tasks;

    /**
     * 任务状态统�?
     */
    @Data
    public static class TaskStatusCount {
        /** 已提�?*/
        private Integer submitted = 0;
        /** 进行�?*/
        private Integer working = 0;
        /** 待用户输�?*/
        private Integer inputRequired = 0;
        /** 已完�?*/
        private Integer completed = 0;
        /** 已取�?*/
        private Integer canceled = 0;
        /** 任务失败 */
        private Integer failed = 0;
        /** 拒绝任务 */
        private Integer rejected = 0;
        /** 待用户授�?*/
        private Integer authRequired = 0;
        /** 未知状�?*/
        private Integer unknown = 0;
    }

    /**
     * 任务基本信息
     */
    @Data
    public static class TaskInfo {
        /** 任务ID */
        private Long taskId;
        /** 外部任务ID */
        private String taskExtId;
        /** 任务标题 */
        private String title;
        /** 任务状�?*/
        private String statusCd;
        /** 任务状态描�?*/
        private String statusCdName;
        /** 任务类型 */
        private String taskType;
        /** 创建时间 */
        private Date createTime;
        /** 更新时间 */
        private Date updateTime;
        /** 系统编码 */
        private String systemNo;
    }
}
