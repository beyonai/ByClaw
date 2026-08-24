package com.iwhalecloud.byai.manager.dto.devloop;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import lombok.Data;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class DevloopTaskStateDto {

    private String schemaVersion;
    private Integer revision;
    private String sessionId;
    private String traceId;
    private String title;
    private String status;
    private String statusLabel;
    private CurrentStage currentStage;
    private Progress progress;
    private Integer loopCount;
    private Integer stageLoopCount;
    private List<Stage> stages;
    private List<TaskStatusItem> taskStatuses;
    private List<Map<String, Object>> transitions;
    private Map<String, Object> pause;
    private String stateFile;
    private String createdAt;
    private String updatedAt;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CurrentStage {

        private String stageId;
        private Integer stageIndex;
        private String stageName;
        private String skill;
        private String activity;
        private String nextAction;
        private String startedAt;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Progress {

        private Integer percent;
        private Integer completedStages;
        private Integer totalStages;
        private String summary;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class TaskStatusItem {

        private String dimensionName;
        private String statusCode;
        private String statusName;
        private String statusDesc;
        private Integer sortOrder;
        private String updatedAt;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Stage {

        private String stageId;
        private Integer sequence;
        private String stageName;
        private String skill;
        private String status;
        private String statusLabel;
        private String activity;
        private String resultSummary;
        private Integer progressPercent;
        private Integer loopCount;
        private String startedAt;
        private String updatedAt;
        private String completedAt;
    }
}
