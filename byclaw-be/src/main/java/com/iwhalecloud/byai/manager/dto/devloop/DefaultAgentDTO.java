package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

/**
 * 默认数字员工入参。projectId 缺省(null)或 0 视为全局默认行,>0 为项目覆盖。
 * 各角色 agentId 为空表示不指定(项目行则回退全局默认)。
 */
@Data
public class DefaultAgentDTO {

    private Long projectId;

    private String architectAgentId;

    private String architectAgentName;

    private String coderAgentId;

    private String coderAgentName;

    private String testerAgentId;

    private String testerAgentName;
}
