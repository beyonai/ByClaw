package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 研发需求子任务实体。
 * 一条研发需求(ScanRequireItem)可拆到多个仓库各起一个会话,支撑需求级就绪批量集成。
 * 需求就绪 = 其下所有子任务的 coder 环节 done;环节由 DevloopPhaseService 从会话消息实时投影,不落库。
 */
@Getter
@Setter
@TableName("byai_scan_item_task")
public class ScanItemTask {

    @TableId(value = "task_id", type = IdType.INPUT)
    private Long taskId;

    /** 来源研发需求ID ScanRequireItem.itemId。 */
    private Long requirementId;

    private Long projectId;

    /** 目标仓库ID ProjectRepo.repoId;单仓库需求可空。 */
    private Long repoId;

    /** 执行该仓库工作的会话ID ByaiSession.sessionId;启动前为空。 */
    private Long sessionId;

    /** 子任务状态 pending待启动/running进行中/done完成/failed失败。 */
    private String status;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
