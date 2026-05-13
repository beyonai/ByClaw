package com.iwhalecloud.byai.common.feign.client;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDocService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.List;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 知识库服务 path 解析器。
 * 这个类负责根据 dataset.system 和统一的 operationId，解析出本次知识库调用应该使用哪个接口 path。
 * 百应自有知识库模式下，path 使用代码中固定维护的 operationId -> path 映射；
 * 第三方知识库模式下，path 从导入知识库 JSON 的 resourceService/openapiSchema/paths 中按 operationId 动态解析。
 * 这样可以保证不管是谁家的知识库，只要 operationId 约定一致，后台就能按统一动作进行分发调用。
 *
 * @author qin.guoquan
 * @date 2026-04-22 11:10:00
 */
@Service
public class KnowledgeServicePathResolver {

    private static final Logger LOGGER = LoggerFactory.getLogger(KnowledgeServicePathResolver.class);

    private final SsResourceService ssResourceService;

    private final SsResExtDocService ssResExtDocService;

    @Value("${dataset.system:}")
    private String datasetSystem;

    /**
     * 构造知识库服务 path 解析器。
     *
     * @author qin.guoquan
     * @date 2026-04-22 11:10:00
     */
    public KnowledgeServicePathResolver(SsResourceService ssResourceService, SsResExtDocService ssResExtDocService) {
        this.ssResourceService = ssResourceService;
        this.ssResExtDocService = ssResExtDocService;
    }

    /**
     * 按 knCode 和统一 operationId 解析本次知识库调用应使用的 path。
     *
     * @author qin.guoquan
     * @date 2026-04-22 11:10:00
     */
    public String resolveByKnCodeAndOperation(String knCode, KnowledgeServiceOperation operation) {
        if (operation == null) {
            throw new IllegalArgumentException("知识库operation不能为空");
        }
        if (StringUtils.isBlank(datasetSystem)) {
            return operation.getLocalPath();
        }
        if (StringUtils.isBlank(knCode)) {
            LOGGER.warn("third-party知识库模式下缺少knCode，回退使用本地固定path, operationId={}",
                operation.getOperationId());
            return operation.getLocalPath();
        }

        JSONObject targetRoot = resolveTargetRootByKnCode(knCode);
        String resolvedPath = extractPathByOperationId(targetRoot, operation.getOperationId());
        if (StringUtils.isBlank(resolvedPath)) {
            throw new IllegalArgumentException("第三方知识库JSON未找到operationId对应的path: " + operation.getOperationId());
        }
        return resolvedPath;
    }

    /**
     * 按知识库编码定位导入 JSON 对应的 targetContent 根节点。
     *
     * @author qin.guoquan
     * @date 2026-04-22 11:10:00
     */
    private JSONObject resolveTargetRootByKnCode(String knCode) {
        List<SsResource> resourceList = ssResourceService.findKnowledgeResourcesByCode(knCode);
        if (resourceList.isEmpty()) {
            throw new IllegalArgumentException("第三方知识库未找到对应资源: " + knCode);
        }
        if (resourceList.size() > 1) {
            throw new IllegalArgumentException("知识库编码重复，请先清理历史数据: " + knCode);
        }
        SsResExtDoc extDoc = ssResExtDocService.findById(resourceList.get(0).getResourceId());
        if (extDoc == null || StringUtils.isBlank(extDoc.getTargetContent())) {
            throw new IllegalArgumentException("第三方知识库targetContent为空: " + knCode);
        }
        try {
            return JSON.parseObject(extDoc.getTargetContent(), Feature.OrderedField);
        }
        catch (Exception e) {
            throw new IllegalArgumentException("第三方知识库targetContent解析失败", e);
        }
    }

    /**
     * 从导入 JSON 的 resourceService/openapiSchema/paths 中按 operationId 反查 path。
     *
     * @author qin.guoquan
     * @date 2026-04-22 11:10:00
     */
    private String extractPathByOperationId(JSONObject targetRoot, String operationId) {
        JSONArray resourceService = targetRoot == null ? null : targetRoot.getJSONArray("resourceService");
        if (resourceService == null || resourceService.isEmpty()) {
            return null;
        }
        for (Object serviceItem : resourceService) {
            if (!(serviceItem instanceof JSONObject serviceJson)) {
                continue;
            }
            JSONObject openapiSchema = serviceJson.getJSONObject("openapiSchema");
            JSONObject paths = openapiSchema == null ? null : openapiSchema.getJSONObject("paths");
            if (paths == null || paths.isEmpty()) {
                continue;
            }
            for (String pathKey : paths.keySet()) {
                JSONObject methodMap = paths.getJSONObject(pathKey);
                if (methodMap == null || methodMap.isEmpty()) {
                    continue;
                }
                for (String httpMethod : methodMap.keySet()) {
                    JSONObject methodDetail = methodMap.getJSONObject(httpMethod);
                    if (methodDetail == null) {
                        continue;
                    }
                    if (StringUtils.equals(operationId, StringUtils.trimToEmpty(methodDetail.getString("operationId")))) {
                        return pathKey;
                    }
                }
            }
        }
        return null;
    }
}
