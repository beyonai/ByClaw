package com.iwhalecloud.byai.state.application.service.tokenserver;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelUpsertRequest;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

/**
 * TokenServer 模型自动分配服务
 * <p>
 * 当 dcSystemConfig 中 ENABLE_TOKEN_SERVER=true 时，
 * 在用户登录时检查该用户是否已有 TokenServer 模型，
 * 若没有则调用 TokenServer API 获取模型配置并插入到个人模型中。
 * </p>
 */
@Service
public class TokenServerProvisionService {

    private static final Logger log = LoggerFactory.getLogger(TokenServerProvisionService.class);

    @Autowired
    private ByaiSystemConfigService systemConfigService;

    @Autowired
    private ByaiAimodelMapper byaiAimodelMapper;

    @Autowired
    private ModelManagementApplicationService modelManagementApplicationService;

    private final RestTemplate restTemplate = new RestTemplate();

    /**
     * 用户登录时检查并自动分配 TokenServer 模型
     *
     * @param userId   用户ID
     * @param userCode 用户工号
     */
    @SuppressWarnings("unchecked")
    public void provisionIfNeeded(Long userId, String userCode) {
        try {
            // 从 MODEL_QUOTA JSON 读取 tokenServer 配置
            String json = systemConfigService.getDcSystemConfigValueByCode("MODEL_QUOTA");
            if (json == null || json.trim().isEmpty()) {
                return;
            }
            JSONObject config = JSON.parseObject(json);
            JSONObject tokenServer = config.getJSONObject("tokenServer");
            if (tokenServer == null || !tokenServer.getBooleanValue("enabled")) {
                return;
            }

            // 检查是否已有 TokenServer 模型
            LambdaQueryWrapper<ByaiAimodel> query = new LambdaQueryWrapper<>();
            query.eq(ByaiAimodel::getCreateBy, userId)
                 .eq(ByaiAimodel::getSourceType, "TOKEN_SERVER");
            Long count = byaiAimodelMapper.selectCount(query);
            if (count != null && count > 0) {
                return;
            }

            // 获取 TokenServer API 地址
            String apiUrl = tokenServer.getString("apiUrl");
            if (apiUrl == null || apiUrl.trim().isEmpty()) {
                log.warn("MODEL_QUOTA.tokenServer.apiUrl 未配置，跳过 TokenServer 模型分配");
                return;
            }

            // 获取模型编码
            String modelCode = tokenServer.getString("modelCode");

            // 调用 TokenServer API 获取模型配置
            Map<String, Object> modelConfig = callTokenServerApi(apiUrl, userCode);
            if (modelConfig == null) {
                log.warn("TokenServer API 返回空，用户={}", userCode);
                return;
            }

            // 构建 upsert 请求插入个人模型
            ModelUpsertRequest upsertRequest = new ModelUpsertRequest();
            upsertRequest.setDisplayName(getStringOrDefault(modelConfig, "modelName", "TokenServer Model"));
            upsertRequest.setModelCode(getStringOrDefault(modelConfig, "modelCode",
                    (modelCode != null && !modelCode.isEmpty()) ? modelCode : "token-server-model"));
            upsertRequest.setApiEndpoint(getStringOrDefault(modelConfig, "apiEndpoint", ""));
            upsertRequest.setApiToken(getStringOrDefault(modelConfig, "apiKey", ""));
            upsertRequest.setModelType("LLM");
            upsertRequest.setModelProtocol(getStringOrDefault(modelConfig, "modelProtocol", "OpenAI"));
            upsertRequest.setStatus("ENABLED");
            upsertRequest.setOwnerType("PERSONAL");
            upsertRequest.setAbilities(new ArrayList<>(List.of("3")));

            modelManagementApplicationService.upsertModel(upsertRequest, userId);

            // 更新 source_type 为 TOKEN_SERVER
            LambdaQueryWrapper<ByaiAimodel> findNew = new LambdaQueryWrapper<>();
            findNew.eq(ByaiAimodel::getCreateBy, userId)
                   .eq(ByaiAimodel::getModelNo, upsertRequest.getModelCode())
                   .orderByDesc(ByaiAimodel::getCreateTime)
                   .last("LIMIT 1");
            ByaiAimodel inserted = byaiAimodelMapper.selectOne(findNew);
            if (inserted != null) {
                inserted.setSourceType("TOKEN_SERVER");
                byaiAimodelMapper.updateById(inserted);
            }

            log.info("TokenServer 模型分配成功，用户={}, modelCode={}", userCode, upsertRequest.getModelCode());

        } catch (Exception e) {
            log.warn("TokenServer 模型分配失败，用户={}: {}", userCode, e.getMessage());
        }
    }

    /**
     * 调用 TokenServer API 获取模型配置
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> callTokenServerApi(String apiUrl, String userCode) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            String body = "{\"userCode\":\"" + userCode + "\"}";
            HttpEntity<String> entity = new HttpEntity<>(body, headers);

            URI uri = URI.create(apiUrl);
            ResponseEntity<Map> response = restTemplate.exchange(uri, HttpMethod.POST, entity, Map.class);

            Map<String, Object> respBody = response.getBody();
            if (respBody == null) {
                return null;
            }
            // 如果有 data 字段则取 data，否则直接用 body
            if (respBody.containsKey("data") && respBody.get("data") instanceof Map) {
                return (Map<String, Object>) respBody.get("data");
            }
            return respBody;
        } catch (Exception e) {
            log.warn("调用 TokenServer API 失败: {}", e.getMessage());
            return null;
        }
    }

    private String getStringOrDefault(Map<String, Object> map, String key, String defaultVal) {
        Object val = map.get(key);
        if (val == null || val.toString().trim().isEmpty()) {
            return defaultVal;
        }
        return val.toString().trim();
    }
}
