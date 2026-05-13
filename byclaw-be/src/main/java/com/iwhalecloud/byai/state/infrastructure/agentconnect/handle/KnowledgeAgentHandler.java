package com.iwhalecloud.byai.state.infrastructure.agentconnect.handle;

import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.state.infrastructure.agentconnect.AgentTypeHandlerFactory;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;

/**
 * @author zht
 * @version 1.0
 * @date 2025/4/17
 */
@Service
public class KnowledgeAgentHandler extends CommonHandler implements InitializingBean {

    @Override
    public void afterPropertiesSet() throws Exception {
        AgentTypeHandlerFactory.register(AgentTypeEnum.AGENT.getNameCode(), this);
        AgentTypeHandlerFactory.register(AgentTypeEnum.DOC_AGENT.getNameCode(), this);
        AgentTypeHandlerFactory.register(AgentTypeEnum.DB_AGENT.getNameCode(), this);
        AgentTypeHandlerFactory.register(AgentTypeEnum.API_AGENT.getNameCode(), this);
    }

}
