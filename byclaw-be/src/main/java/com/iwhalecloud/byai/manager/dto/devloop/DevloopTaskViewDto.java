package com.iwhalecloud.byai.manager.dto.devloop;

import java.util.Date;

import lombok.Data;

@Data
public class DevloopTaskViewDto {

    private Long taskId;
    private Long sessionId;
    private Long projectId;
    private String title;
    private String sessionContent;
    private Long createBy;
    private Date createTime;
    private Date updateTime;
    private Boolean stateAvailable;
    private String traceId;
    private Integer revision;
    private String status;
    private String statusLabel;
    private DevloopTaskStateDto.CurrentStage currentStage;
    private Integer progress;
    private Integer loopCount;
    private Integer stageLoopCount;
    private String assignee;
    private String agentName;
    private String branchName;
    private String repoFullName;
    private String requirementTitle;
    private String requirementOriginId;
    private Long sourceItemId;
    private String warningTag;
}
