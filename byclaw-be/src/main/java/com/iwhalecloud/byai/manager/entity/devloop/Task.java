package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
@TableName("byai_task")
public class Task {

    @TableId(value = "task_id", type = IdType.INPUT)
    private Long taskId;

    private Long projectId;

    private Long sourceItemId;

    private String title;

    private String status;

    private String phase;

    private Integer currentRound;

    private Integer totalRounds;

    private Integer score;

    private String assignee;

    private String agentName;

    private String branchName;

    private String warningTag;

    private Long sessionId;

    private Date createTime;

    private Date updateTime;

    private String deleteFlag;
}
