package com.iwhalecloud.byai.manager.vo.operations;

import lombok.Getter;
import lombok.Setter;

/** 工作组项目与平台云盘关联的安全投影。 @author Codex @since 2026-11-02 */
@Getter
@Setter
public class EnterpriseCloudResourceVo {
    private Long projectId;
    private String projectName;
    private Long cloudResourceId;
    private String knCode;
}
