package com.iwhalecloud.byai.manager.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/**
 * 资源标准 JSON 根节点构建器。
 *
 * 该类只负责为 targetContent / 同步到开放资源目录的 JSON 根节点补齐公共运行时字段，
 * 不接管各资源自己的业务内容，例如 fields、objects、resourceService 等节点。
 *
 * @author qin.guoquan
 * @date 2026-04-26 13:10:00
 */
@Service
public class ResourceTargetJsonBuilder {

    /**
     * 基于原始 JSON 构建以 resourceId 开头、并带运行时字段的目标 JSON。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public String buildWithResourceIdFirst(JSONObject root, SsResource resource, boolean resourceIdAsString) {
        return buildWithResourceIdFirst(root, resource.getResourceId(),
            new ResourceRuntimeInfo(resource.getImplType(), resource.getWorkerAgentType()), resourceIdAsString);
    }

    /**
     * 基于原始 JSON 构建以 resourceId 开头、并带运行时字段的目标 JSON。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public String buildWithResourceIdFirst(JSONObject root, Long resourceId, ResourceRuntimeInfo runtimeInfo,
        boolean resourceIdAsString) {
        JSONObject merged = new JSONObject(true);
        merged.put("resourceId", resourceIdAsString ? String.valueOf(resourceId) : resourceId);
        enrichRoot(merged, runtimeInfo);
        if (root != null) {
            for (String key : root.keySet()) {
                if (StringUtils.equalsAny(key, "resourceId", "implType", "workerAgentType")) {
                    continue;
                }
                merged.put(key, root.get(key));
            }
        }
        enrichRoot(merged, runtimeInfo);
        return JSON.toJSONString(merged);
    }

    /**
     * 在目标 JSON 根节点补齐运行时字段。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public void enrichRoot(JSONObject root, SsResource resource) {
        if (resource == null) {
            return;
        }
        enrichRoot(root, new ResourceRuntimeInfo(resource.getImplType(), resource.getWorkerAgentType()));
    }

    /**
     * 在目标 JSON 根节点补齐运行时字段。
     *
     * @author qin.guoquan
     * @date 2026-04-26 13:10:00
     */
    public void enrichRoot(JSONObject root, ResourceRuntimeInfo runtimeInfo) {
        if (root == null || runtimeInfo == null) {
            return;
        }
        root.put("implType", StringUtils.trimToEmpty(runtimeInfo.getImplType()));
        root.put("workerAgentType", StringUtils.trimToEmpty(runtimeInfo.getWorkerAgentType()));
    }
}
