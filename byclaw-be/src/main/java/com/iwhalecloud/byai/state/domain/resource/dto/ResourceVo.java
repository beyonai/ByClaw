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
}
