package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 独立测试数字员工配置:需求级集成的定时节流 + 就绪准入 + 失败打回策略。
 * 每研发项目一行有效配置;执行员工不在此表,统一取全局「测试数字员工」默认(DefaultAgent 解析)。
 */
@Getter
@Setter
@TableName("byai_tester_config")
public class TesterConfig {

    @TableId(value = "id", type = IdType.INPUT)
    private Long id;

    /** 所属研发项目ID byai_project.project_id */
    private Long projectId;

    /** 是否启用定时批量集成 1启用 0停用 */
    private String enabled;

    /** 标准5段cron,决定「多久看一次」 */
    private String cron;

    /** cron人话展示 */
    private String cronLabel;

    /** 计算下次运行的时区 */
    private String timezone;

    /** 就绪门禁:所有子任务都coded才纳入 1是 0否 */
    private String requireAllCoded;

    /** 单轮最多并行几个需求的E2E */
    private Integer maxConcurrentReqs;

    /** 失败自动归因并打回 1是 0否 */
    private String autoAttribute;

    /** 归因不清时新建集成缺陷任务 1是 0否 */
    private String createDefectWhenUnclear;

    /** 同一需求最多自动打回轮次 */
    private Integer maxRounds;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
