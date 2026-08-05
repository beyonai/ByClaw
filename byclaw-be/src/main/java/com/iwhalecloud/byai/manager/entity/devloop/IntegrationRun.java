package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 集成测试执行记录:一次「执行测试」的主记录与 JUnit 汇总结果。
 * status 与前端 IntegrationRunResult 契约对齐:running/passed/failed/error/timeout。
 */
@Getter
@Setter
@TableName("byai_integration_run")
public class IntegrationRun {

    @TableId(value = "run_id", type = IdType.INPUT)
    private Long runId;

    private Long projectId;

    private Long suiteId;

    private Long envId;

    /** 触发本次执行的研发需求ID ScanRequireItem.itemId;人工单套件执行可空。 */
    private Long requirementId;

    private String status;

    private String branch;

    private String commitRef;

    private Integer total;

    private Integer passed;

    private Integer failed;

    private Integer skipped;

    /** 打回目标环节(失败时记录);由失败打回引擎驱动会话回到该环节重工 */
    private String kickbackTo;

    private String reason;

    /** 失败打回引擎处理本次执行的时间;非空表示已处理,幂等去重用 */
    private Date kickbackAt;

    /** 远程结果目录(完整日志/报告/截图落地处) */
    private String resultDir;

    /** JUnit解析出的套件结果数组JSON(对齐前端 IntegrationRunSuiteResult) */
    private String suitesJson;

    private Date startedAt;

    private Date finishedAt;

    private Integer durationSec;

    private Long createBy;

    private Date createTime;

    private String deleteFlag;
}
