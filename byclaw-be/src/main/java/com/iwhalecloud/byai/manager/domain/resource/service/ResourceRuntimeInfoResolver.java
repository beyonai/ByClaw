package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.common.constants.resource.DigitalEmployType;
import com.iwhalecloud.byai.common.constants.resource.ImplType;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/**
 * 资源运行时注册信息解析器。
 *
 * 该类只负责根据资源类型、实现方式、数字员工类型等输入，统一推导 ss_resource.impl_type 与
 * ss_resource.worker_agent_type 的值；各导入/新增流程仍负责自己的主表、子表业务字段。
 *
 * @author qin.guoquan
 * @date 2026-04-26 13:10:00
 */
@Service
public class ResourceRuntimeInfoResolver {

    /**
     * 解析 TOOLKIT / MCP / AGENT JSON 导入时的运行时注册信息。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public ResourceRuntimeInfo resolveToolJson(String resourceBizType, String implType) {
        String effectiveImplType = StringUtils.defaultIfBlank(StringUtils.trimToEmpty(implType),
            ImplType.API.getCode());
        if (StringUtils.equalsAny(effectiveImplType, ImplType.API.getCode(), ImplType.SSE.getCode())) {
            return new ResourceRuntimeInfo(effectiveImplType, WorkerAgentType.NONE.getCode());
        }
        if (StringUtils.equalsAny(effectiveImplType, ImplType.ASK_PERSONAL.getCode(), ImplType.ASK_AGENT.getCode())) {
            if (StringUtils.equals(resourceBizType, ResourceBizType.AGENT.getCode())) {
                return new ResourceRuntimeInfo(effectiveImplType, WorkerAgentType.BYCLAW_EXE.getCode());
            }
            if (StringUtils.equalsAny(resourceBizType, ResourceBizType.MCP.getCode(),
                ResourceBizType.TOOLKIT.getCode())) {
                return new ResourceRuntimeInfo(effectiveImplType, WorkerAgentType.NONE.getCode());
            }
        }
        return new ResourceRuntimeInfo(effectiveImplType, WorkerAgentType.NONE.getCode());
    }

    /**
     * 解析知识库类 KG_* 资源的运行时注册信息。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public ResourceRuntimeInfo resolveKnowledge() {
        return new ResourceRuntimeInfo(ImplType.ASK_AGENT.getCode(), WorkerAgentType.BYCLAW_QA.getCode());
    }

    /**
     * 解析对象、视图类资源的运行时注册信息。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public ResourceRuntimeInfo resolveObjectView() {
        return new ResourceRuntimeInfo(ImplType.ASK_AGENT.getCode(), WorkerAgentType.BYCLAW_DATA.getCode());
    }

    /**
     * 根据数字员工类型解析运行时注册信息。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public ResourceRuntimeInfo resolveDigitalEmployee(String agentType, Long resourceId) {
        String normalizedAgentType = StringUtils.trimToEmpty(agentType);
        if (StringUtils.equals(normalizedAgentType, DigitalEmployType.AGENT_TYPE_QA.getCode())) {
            return new ResourceRuntimeInfo(ImplType.ASK_AGENT.getCode(), WorkerAgentType.BYCLAW_QA.getCode());
        }
        if (StringUtils.equals(normalizedAgentType, DigitalEmployType.AGENT_TYPE_DATA.getCode())) {
            return new ResourceRuntimeInfo(ImplType.ASK_AGENT.getCode(), WorkerAgentType.BYCLAW_DATA.getCode());
        }
        if (StringUtils.equals(normalizedAgentType, DigitalEmployType.AGENT_TYPE_DEBUG.getCode())) {
            return new ResourceRuntimeInfo(ImplType.ASK_AGENT.getCode(),
                WorkerAgentType.DEBUG.getCode() + "_" + resourceId);
        }
        if (StringUtils.equals(normalizedAgentType, DigitalEmployType.AGENT_TYPE_CODE.getCode())) {
            return new ResourceRuntimeInfo(ImplType.ASK_AGENT.getCode(), WorkerAgentType.BYCLAW_CODE.getCode());
        }
        return new ResourceRuntimeInfo(ImplType.ASK_AGENT.getCode(), WorkerAgentType.BYCLAW_EXE.getCode());
    }

    /**
     * 把解析结果回填到资源主表实体。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public void fillResource(SsResource resource, ResourceRuntimeInfo runtimeInfo) {
        if (resource == null || runtimeInfo == null) {
            return;
        }
        resource.setImplType(runtimeInfo.getImplType());
        resource.setWorkerAgentType(runtimeInfo.getWorkerAgentType());
    }
}
