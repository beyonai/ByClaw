package com.iwhalecloud.byai.state.domain.taskplan.dto;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonFormat;

import lombok.Data;

/** WebSocket 与工具返回共用的完整任务计划快照。 */
@Data
public class TaskPlanSnapshot {

    public static final String SCHEMA_VERSION = "byclaw.task-plan/v1";

    private String planId;

    private Integer version;

    private String title;

    private String status;

    private StatusReason statusReason;

    private String sessionId;

    private String messageId;

    private String turnId;

    private String laneId;

    private String traceId;

    private String sourceRuntime;

    private String sourceRunId;

    private String explanation;

    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", timezone = "GMT+8")
    private Date createdAt;

    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", timezone = "GMT+8")
    private Date updatedAt;

    private List<TaskSnapshot> tasks = new ArrayList<>();

    @Data
    public static class TaskSnapshot {

        private String taskId;

        private Integer position;

        private String title;

        private String description;

        private String status;

        private StatusReason statusReason;

        @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", timezone = "GMT+8")
        private Date updatedAt;

        @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", timezone = "GMT+8")
        private Date startedAt;

        @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", timezone = "GMT+8")
        private Date completedAt;
    }

    @Data
    public static class StatusReason {

        private String code;

        private String message;

        public StatusReason() {
        }

        public StatusReason(String code, String message) {
            this.code = code;
            this.message = message;
        }
    }
}
