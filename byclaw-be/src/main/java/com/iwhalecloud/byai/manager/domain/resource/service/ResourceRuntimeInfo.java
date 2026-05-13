package com.iwhalecloud.byai.manager.domain.resource.service;

/**
 * 资源运行时注册信息，统一承载 ss_resource.impl_type 与 ss_resource.worker_agent_type 的推导结果。
 *
 * @author qin.guoquan
 * @date 2026-04-26 13:10:00
 */
public class ResourceRuntimeInfo {

    private final String implType;

    private final String workerAgentType;

    /**
     * 构造资源运行时注册信息。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public ResourceRuntimeInfo(String implType, String workerAgentType) {
        this.implType = implType;
        this.workerAgentType = workerAgentType;
    }

    /**
     * 获取资源实现方式。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public String getImplType() {
        return implType;
    }

    /**
     * 获取 Worker 注册类型。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public String getWorkerAgentType() {
        return workerAgentType;
    }
}
