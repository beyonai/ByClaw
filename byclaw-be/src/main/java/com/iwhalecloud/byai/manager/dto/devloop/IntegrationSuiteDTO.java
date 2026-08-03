package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 端到端测试用例集入参。manualCases 清单不入库(在仓库文件里),仅登记 manualFile 路径。
 */
@Data
public class IntegrationSuiteDTO {

    private Long suiteId;

    private Long projectId;

    private String suiteName;

    private String runner;

    private String sourceType;

    private Long repoId;

    private String source;

    private String branch;

    private String runCommand;

    private String workdir;

    private String reportPath;

    private Integer caseCount;

    private String enabled;

    /** 仅manual套件:仓库内清单文件路径 */
    private String manualFile;
}
