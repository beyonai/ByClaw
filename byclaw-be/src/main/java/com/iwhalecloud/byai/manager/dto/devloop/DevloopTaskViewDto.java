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
    /** 关联数字员工头像，供任务详情与会话列表复用。 */
    private String avatar;
    /** 会话绑定对象类型，DigEmployee 表示绑定数字员工。前端据此判断进入会话后是否默认 @ 员工。 */
    private String objectType;
    /** 会话绑定的数字员工 resourceId。前端只有名称无法回填 @，必须同源返回 ID。 */
    private Long objectId;
    private String branchName;
    private String repoFullName;
    private String requirementTitle;
    private String requirementOriginId;
    private Long sourceItemId;
    private String warningTag;
    /**
     * 任务类型，取值见 DevloopTaskType：architect/requirement/coder/tester，均不命中为 chat。
     * 会话表没有类型列，由各创建链路留下的关联行反查得出。
     */
    private String taskType;
}
