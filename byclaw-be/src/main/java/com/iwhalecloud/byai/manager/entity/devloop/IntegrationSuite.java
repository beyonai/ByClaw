package com.iwhalecloud.byai.manager.entity.devloop;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 端到端测试用例集:自动化套件按运行命令执行、按JUnit报告收结果;
 * manual 套件的清单在仓库文件里,不入库,这里只登记 manualFile 路径。
 */
@Getter
@Setter
@TableName("byai_integration_suite")
public class IntegrationSuite {

    @TableId(value = "suite_id", type = IdType.INPUT)
    private Long suiteId;

    private Long projectId;

    private String suiteName;

    /** 执行器 pytest/playwright/jest/vitest/custom/manual */
    private String runner;

    /** 来源类型 git/shared;manual套件无来源仓库 */
    private String sourceType;

    /** 仅git来源:关联项目仓库ID byai_project_repo.repo_id;权威关联,仓库改名不失效 */
    private Long repoId;

    private String source;

    private String branch;

    private String runCommand;

    private String workdir;

    /** JUnit XML报告相对路径,后端据此汇总通过率;manual套件为空 */
    private String reportPath;

    private Integer caseCount;

    private String enabled;

    /** 仅manual套件:仓库内清单文件路径;清单本身不入库 */
    private String manualFile;

    private Long createBy;

    private Date createTime;

    private Long updateBy;

    private Date updateTime;

    private String deleteFlag;
}
