package com.iwhalecloud.byai.manager.dto.devloop;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.List;

/**
 * 测试数字员工写入 /by/.sessions/{sessionId}/integration-result.json 的结构化结果。
 * 结果回收 poller 读它拿 total/passed/failed/skipped 与失败用例名,映射到 byai_integration_run 看板列。
 * 字段命名与提示词约定一致(camelCase),多余字段忽略以兼容员工附带的额外信息。
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class IntegrationResultDto {

    private Integer total;
    private Integer passed;
    private Integer failed;
    private Integer skipped;
    private List<String> failedCases;
}
