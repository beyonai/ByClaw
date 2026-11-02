package com.iwhalecloud.byai.manager.domain.operations;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServiceEndpoint;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServiceEndpointResolver;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServiceOperation;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServicePathResolver;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeStatus;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeStatusResult;
import com.iwhalecloud.byai.manager.mapper.operations.EnterpriseStorageMapper;
import com.iwhalecloud.byai.manager.vo.operations.EnterpriseCloudResourceVo;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** 按企业汇总工作组的逻辑容量，保留文件的已解散组仍参与。 @author Codex @since 2026-11-02 */
@Service
public class EnterpriseStorageService {
    @Autowired
    private EnterpriseStorageMapper enterpriseStorageMapper;

    @Autowired
    private FeignPythonBuildService feignPythonBuildService;

    @Autowired
    private KnowledgeServiceEndpointResolver knowledgeServiceEndpointResolver;

    @Autowired
    private KnowledgeServicePathResolver knowledgeServicePathResolver;

    @Autowired
    private ObjectMapper objectMapper;

    /** @param enterpriseId 企业编号 @param actorId 已认证操作人 @return 完整成功的汇总及云盘明细 */
    public JsonNode summary(long enterpriseId, long actorId) {
        if (enterpriseId <= 0 || !enterpriseStorageMapper.canRead(enterpriseId, actorId)) {
            throw new OperationsFailure("DENIED");
        }
        return usage(enterpriseId);
    }

    /** 已完成写入鉴权的配额入口复用同一统计口径，不依赖用户入组列表。 */
    public JsonNode usage(long enterpriseId) {
        List<EnterpriseCloudResourceVo> clouds = enterpriseStorageMapper.selectClouds(enterpriseId);
        Map<String, EnterpriseCloudResourceVo> uniqueClouds = new LinkedHashMap<>();
        for (EnterpriseCloudResourceVo cloud : clouds) {
            // 尚未初始化与损坏关联均不能伪装成空库。
            if (cloud.getCloudResourceId() == null || cloud.getKnCode() == null || cloud.getKnCode().isBlank()) {
                throw new OperationsFailure("UNAVAILABLE");
            }
            EnterpriseCloudResourceVo existingCloud = uniqueClouds.putIfAbsent(cloud.getKnCode().strip(), cloud);
            // 多个项目共享同一资源可以去重；不同资源复用编码会使既有知识服务路由产生歧义。
            if (existingCloud != null && !existingCloud.getCloudResourceId().equals(cloud.getCloudResourceId())) {
                throw new OperationsFailure("UNAVAILABLE");
            }
        }
        Map<List<String>, List<String>> batches = new LinkedHashMap<>();
        for (String knCode : uniqueClouds.keySet()) {
            KnowledgeServiceEndpoint endpoint = knowledgeServiceEndpointResolver.resolveByKnCode(knCode);
            String path = knowledgeServicePathResolver.resolveByKnCodeAndOperation(knCode, KnowledgeServiceOperation.STATUS);
            List<String> route = List.of(Boolean.toString(endpoint.isDirectUrl()),
                endpoint.isDirectUrl() ? endpoint.getBaseUrl() : endpoint.getServiceName(), path);
            batches.computeIfAbsent(route, ignored -> new ArrayList<>()).add(knCode);
        }
        Map<String, KnowledgeStatusResult.Item> statistics = new LinkedHashMap<>();
        // 不同知识服务分别批量查询，避免将其他端点的编码发送给首个服务。
        for (List<String> codes : batches.values()) {
            KbKnowledgeStatus knowledgeStatus = new KbKnowledgeStatus();
            knowledgeStatus.setKnCodeList(codes);
            PythonBuildResponse<KnowledgeStatusResult> response = feignPythonBuildService.knowledgeStatus(knowledgeStatus);
            validateBatch(response, codes, statistics);
        }
        ObjectNode result = objectMapper.createObjectNode();
        ArrayNode details = result.putArray("groups");
        BigDecimal usedKb = BigDecimal.ZERO;
        long fileCount = 0;
        for (Map.Entry<String, EnterpriseCloudResourceVo> entry : uniqueClouds.entrySet()) {
            KnowledgeStatusResult.Item item = statistics.get(entry.getKey());
            EnterpriseCloudResourceVo cloud = entry.getValue();
            usedKb = usedKb.add(item.getSpaceSize());
            fileCount = Math.addExact(fileCount, item.getFileCount());
            details.addObject().put("projectId", cloud.getProjectId().toString())
                .put("name", cloud.getProjectName()).put("usedKb", item.getSpaceSize().stripTrailingZeros().toPlainString())
                .put("fileCount", item.getFileCount());
        }
        return result.put("usedKb", usedKb.stripTrailingZeros().toPlainString()).put("fileCount", fileCount)
            .put("sampledAt", Instant.now().toString());
    }

    /** @param response QA 信封 @param codes 本批编码 @param statistics 完整结果累积，任意缺项均失败 */
    private void validateBatch(PythonBuildResponse<KnowledgeStatusResult> response, List<String> codes,
            Map<String, KnowledgeStatusResult.Item> statistics) {
        if (response == null || !"0".equals(response.getResultCode()) || response.getResultObject() == null
                || response.getResultObject().getData() == null || response.getResultObject().getData().size() != codes.size()) {
            throw new OperationsFailure("UNAVAILABLE");
        }
        for (KnowledgeStatusResult.Item item : response.getResultObject().getData()) {
            if (item == null || !codes.contains(item.getKnCode()) || statistics.containsKey(item.getKnCode())
                    || item.getFileCount() == null || item.getFileCount() < 0 || item.getSpaceSize() == null
                    || item.getSpaceSize().signum() < 0 || item.getSpaceSize().stripTrailingZeros().scale() > 2) {
                throw new OperationsFailure("UNAVAILABLE");
            }
            statistics.put(item.getKnCode(), item);
        }
    }
}
