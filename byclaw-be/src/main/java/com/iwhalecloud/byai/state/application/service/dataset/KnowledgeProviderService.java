package com.iwhalecloud.byai.state.application.service.dataset;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDocService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunResult;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceCurlService;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/** Reuses trusted, imported provider descriptions and the existing curl target boundary. */
@Service @RequiredArgsConstructor
public class KnowledgeProviderService {
    private final SsResourceMapper resources;
    private final SsResExtDocService documents;
    private final AuthApplicationService auth;
    private final ResourceCurlService curl;
    public record Option(String providerId, String providerName) { }
    public record Provider(SsResource resource, JSONObject description, JSONObject operation) { }

    public List<Option> options() {
        List<Option> result = new ArrayList<>();
        for (SsResource row : resources.selectList(new LambdaQueryWrapper<SsResource>()
            .eq(SsResource::getComAcctId, CurrentUserHolder.getEnterpriseId())
            .eq(SsResource::getResourceBizType, "KG_DOC").eq(SsResource::getResourceStatus, 2))) {
            try {
                Provider provider = provider(row.getResourceId().toString());
                result.add(new Option(row.getResourceId().toString(), provider.resource().getResourceName()));
            } catch (BaseException | IllegalArgumentException ignored) {
                // Query-only or inaccessible resources are not creation providers.
            }
        }
        return result;
    }
    public Provider provider(String id) {
        Long resourceId;
        try { resourceId = Long.valueOf(id); } catch (RuntimeException error) { throw new BaseException("请选择有效知识服务提供方"); }
        SsResource row = resources.selectById(resourceId);
        if (row == null || !Objects.equals(row.getComAcctId(), CurrentUserHolder.getEnterpriseId())
            || !"KG_DOC".equals(row.getResourceBizType()) || !Objects.equals(row.getResourceStatus(), 2)
            || !auth.hasResourceUsePermission(row)) throw new BaseException("无权使用该知识服务提供方");
        var document = documents.findById(resourceId);
        if (document == null || !"external".equalsIgnoreCase(document.getType())) throw new BaseException("请选择外部知识服务提供方");
        JSONObject root = JSON.parseObject(document.getTargetContent());
        JSONObject operation = creationOperation(root);
        if (operation == null) throw new BaseException("该提供方没有 create_kb 能力");
        return new Provider(row, root, operation);
    }
    static JSONObject creationOperation(JSONObject root) {
        JSONArray services = root == null ? null : root.getJSONArray("resourceService");
        if (services == null) return null;
        for (int i = 0; i < services.size(); i++) {
            JSONObject service = services.getJSONObject(i);
            if (service == null) continue;
            if ("create_kb".equalsIgnoreCase(service.getString("action"))
                && "POST".equalsIgnoreCase(StringUtils.defaultIfBlank(service.getString("method"), "POST"))
                && StringUtils.isNotBlank(service.getString("path"))) return service;
            JSONObject schema = service.getJSONObject("openapiSchema");
            JSONObject paths = schema == null ? null : schema.getJSONObject("paths");
            if (paths == null) continue;
            for (String path : paths.keySet()) {
                JSONObject post = paths.getJSONObject(path).getJSONObject("post");
                if (post != null && "create_kb".equalsIgnoreCase(post.getString("operationId"))) return service;
            }
        }
        return null;
    }
    public String create(Provider provider, String proposedCode, String name, String description) {
        Map<String, Object> body = new LinkedHashMap<>();
        for (String key : List.of("knCode", "kbCode", "knowledgeCode", "knowledgeBaseCode", "resourceCode")) body.put(key, proposedCode);
        for (String key : List.of("knName", "kbName", "name")) body.put(key, name);
        for (String key : List.of("knDescription", "kbDescription", "description")) body.put(key, description);
        JSONObject root = provider.description();
        Map<String, Object> headers = root.getJSONObject("headers") == null ? Map.of() : root.getJSONObject("headers");
        JSONObject schema = provider.operation().getJSONObject("openapiSchema");
        ResourceCurlRunResult result;
        if (schema != null) {
            if (!schema.containsKey("servers")) schema.put("domainURL", root.getString("domainURL"));
            result = curl.runOpenApiOperationOnce("KG_DOC", root.toJSONString(), schema, "create_kb", body, headers);
        } else {
            String domain = root.getString("domainURL");
            if (StringUtils.isBlank(domain)) throw new BaseException("提供方缺少 domainURL");
            String url = StringUtils.removeEnd(domain, "/") + "/" + StringUtils.removeStart(provider.operation().getString("path"), "/");
            result = curl.runSimpleJsonOperationOnce("KG_DOC", root.toJSONString(), url, body, headers);
        }
        return createdCode(result);
    }
    static String createdCode(ResourceCurlRunResult result) {
        if (result == null || !Boolean.TRUE.equals(result.getSuccess())) throw new BaseException("外部建库结果未知，请核对创建任务后处理");
        JSONObject body;
        try { body = JSON.parseObject(result.getBody()); } catch (RuntimeException error) { throw new BaseException("外部建库响应无法识别，请核对创建任务"); }
        if (body == null || (body.containsKey("resultCode") && !"0".equals(body.getString("resultCode")))
            || (body.containsKey("code") && !Set.of("0", "200").contains(body.getString("code")))) throw new BaseException("提供方未确认建库成功，请核对创建任务");
        JSONObject data = body.getJSONObject("resultObject");
        if (data == null && body.get("data") instanceof JSONObject object) data = object;
        if (data == null) data = body;
        for (String key : List.of("knCode", "kbCode", "knowledgeCode", "knowledgeBaseCode", "resourceCode")) {
            String code = data.getString(key);
            if (StringUtils.isNotBlank(code) && code.length() <= 255) return code;
        }
        throw new BaseException("提供方未返回知识库编码，请核对创建任务，不会自动重复创建");
    }
}
