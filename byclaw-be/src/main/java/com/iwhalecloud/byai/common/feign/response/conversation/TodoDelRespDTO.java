package com.iwhalecloud.byai.common.feign.response.conversation;

import lombok.Data;

import java.io.Serializable;
import java.util.List;

@Data
public class TodoDelRespDTO implements Serializable {

    /** 删除成功的任务数�?*/
    private Integer successCount;

    /** 删除失败的任务数�?*/
    private Integer failureCount;

    /** 总任务数�?*/
    private Integer totalCount;

    /** 删除成功的任务ID列表 */
    private List<Long> successTaskIds;

    /** 删除失败的任务信�?*/
    private List<FailedTaskInfo> failedTasks;

    /** 删除原因 */
    private String deleteReason;

    /**
     * 失败任务信息
     */
    @Data
    public static class FailedTaskInfo {
        /** 任务ID */
        private Long taskId;
        /** 任务标题 */
        private String title;
        /** 失败原因 */
        private String failureReason;
    }
}
