package com.iwhalecloud.byai.state.infrastructure.agentconnect.handle;

import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.state.domain.agent.dto.AgentDto;

/**
 * @author zht
 * @version 1.0
 * @date 2025/4/17
 */
@Service
public abstract class AgentTypeHandlerAbstract {

    /**
     * 处理智能体表头 ByaiAgent
     * 
     * @param agentDto 智能体
     */
    public abstract void handleHeader(AgentDto agentDto);

}
