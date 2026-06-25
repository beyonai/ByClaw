package com.iwhalecloud.byai.state.domain.resource.dto;

import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import lombok.Data;

@Data
public class ResourceVo {

    private String resourceId;

    private String resourceName;

    /**
     * HUMAN：真人 HUMAN_ASSISTANT：超级助理
     */
    private AgentMetaEnum resourceType;

    private String resourceCode;

    /**
     * 不同 resourceType 的补充数据（JSON 字符串）。
     * 例如 SKILL 类型存储 skillType、skillUrl、version 等扩展信息。
     */
    private String extData;
}
