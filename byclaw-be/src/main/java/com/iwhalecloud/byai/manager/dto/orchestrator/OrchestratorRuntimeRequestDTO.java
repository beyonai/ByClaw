package com.iwhalecloud.byai.manager.dto.orchestrator;

import lombok.Getter;
import lombok.Setter;

/**
 * byclaw-super 查询数字员工组运行快照的请求。
 *
 * @author qin.guoquan
 * @date 2026-08-10 17:38:38
 */
@Getter
@Setter
public class OrchestratorRuntimeRequestDTO {

    private String schemaVersion;

    private String kind;

    private String orchestratorId;
}
