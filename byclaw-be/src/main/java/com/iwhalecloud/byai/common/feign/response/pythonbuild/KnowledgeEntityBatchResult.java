package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

/** QA 知识实体发现、补全任务的批次受理结果。
 *
 * @author qin.guoquan
 * @date 2026-08-19 16:25:38
 * */
@Getter
@Setter
public class KnowledgeEntityBatchResult {

    /** 门户知识库资源 ID，由门户补充，QA 原始响应不包含该字段。 */
    private Long resourceId;

    private String batchId;

    private String scope;

    private String taskType;

    private Integer eligibleCount;

    private Integer acceptedCount;

    private Integer reusedCount;

    private Integer skippedCount;

    private List<Task> tasks = new ArrayList<>();

    @Getter
    @Setter
    public static class Task {

        private String taskId;

        private String status;

        private String fileId;

        private String filePath;

        private Boolean reused;

        private String skipReason;
    }
}
