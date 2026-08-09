package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 集成测试执行步骤明细:一次 run 内每个 stage/命令的退出码与日志。日志截断存尾部。
 */
@Getter
@Setter
@TableName("byai_integration_run_step")
public class IntegrationRunStep {

    @TableId(value = "step_id", type = IdType.INPUT)
    private Long stepId;

    private Long runId;

    private Integer seq;

    /** 步骤类型 stage环境阶段/suite用例集命令 */
    private String stepType;

    private String stepName;

    private Integer exitCode;

    private String status;

    private Integer durationSec;

    /** stdout/stderr合并日志(截断存尾部) */
    private String logText;

    private Date startedAt;

    private Date finishedAt;
}
