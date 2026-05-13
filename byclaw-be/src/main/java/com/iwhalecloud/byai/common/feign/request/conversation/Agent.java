package com.iwhalecloud.byai.common.feign.request.conversation;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-08-08 20:33:38
 * @description TODO
 */
@Getter
@Setter
public class Agent {

    private Long agentId;

    private String agentName;

    private String agentCode;

    private String agentDesc;

    private String agentType;

    private String agentDevType;

    private String agentSseHead;

    private String agentSseUrl;

    /**
     * 集成类型，用于标识数字员工的集成方式,A2A:a2a协议， INTERFACE：sse接口集成
     */
    private String integrationType;


}
