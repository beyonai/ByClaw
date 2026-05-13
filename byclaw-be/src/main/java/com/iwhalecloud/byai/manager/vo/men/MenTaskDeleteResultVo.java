package com.iwhalecloud.byai.manager.vo.men;

import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 删除待办任务结果对象
 */
@Data
public class MenTaskDeleteResultVo implements Serializable {

    /** 删除成功的任务数量 */
    private Integer successCount;

    /** 删除失败的任务数量 */
    private Integer failureCount;

    /** 总任务数量 */
    private Integer totalCount;

    /** 删除成功的任务ID列表 */
    private List<Long> successTaskIds;

    /** 删除失败的任务信息 */
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

    /**
     * 创建删除结果
     */
    public static MenTaskDeleteResultVo createResult(int successCount, int totalCount, String deleteReason) {
        MenTaskDeleteResultVo result = new MenTaskDeleteResultVo();
        result.setSuccessCount(successCount);
        result.setFailureCount(totalCount - successCount);
        result.setTotalCount(totalCount);
        result.setDeleteReason(deleteReason);
        return result;
    }
}
