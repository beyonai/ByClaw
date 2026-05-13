package com.iwhalecloud.byai.state.infrastructure.agentconnect;

import java.util.Map;

import com.google.common.collect.Maps;
import com.iwhalecloud.byai.state.infrastructure.agentconnect.handle.AgentTypeHandlerAbstract;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

/**
 * @author zht
 * @version 1.0
 * @date 2025/4/17
 */
public class AgentTypeHandlerFactory {

    private static final Map<String, AgentTypeHandlerAbstract> factoryMap = Maps.newHashMap();

    public static AgentTypeHandlerAbstract getHandler(String agentType) {
        AgentTypeHandlerAbstract agentTypeHandlerAbstract = factoryMap.get(agentType);
        if (agentTypeHandlerAbstract == null) {
            throw new BdpRuntimeException(I18nUtil.get("agent.type.handler.factory.type.error", agentType));
        }
        return agentTypeHandlerAbstract;
    }

    public static  void register(String agentType, AgentTypeHandlerAbstract handler) {
        factoryMap.put(agentType, handler);
    }

}
