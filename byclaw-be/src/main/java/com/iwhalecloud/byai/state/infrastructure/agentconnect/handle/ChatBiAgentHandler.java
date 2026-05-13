package com.iwhalecloud.byai.state.infrastructure.agentconnect.handle;

import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.state.infrastructure.agentconnect.AgentTypeHandlerFactory;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.domain.agent.dto.AgentDto;

/**
 * @author zht
 * @version 1.0
 * @date 2025/4/17
 */
@Service
public class ChatBiAgentHandler extends CommonHandler implements InitializingBean {

    @Override
    public void handleHeader(AgentDto agentDto) {
        super.handleHeader(agentDto);
    }

    @Override
    public void afterPropertiesSet() throws Exception {
        AgentTypeHandlerFactory.register(AgentTypeEnum.CHATBI.getNameCode(), this);
        AgentTypeHandlerFactory.register(AgentTypeEnum.CHATBI.getName(), this);
    }
}
