package com.iwhalecloud.byai.state.application.service.tokensaver;

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
 * TokenSaver 模型自动分配服务
 * <p>
 * 当 MODEL_QUOTA.tokenSaver.enabled=true 时，
 * 在用户登录时检查该用户是否已有 TokenSaver 模型，
 * 若没有则调用 TokenSaver API 获取模型配置并插入到个人模型中。
 * </p>
 */
@Service
public class TokenSaverProvisionService {

    private static final Logger log = LoggerFactory.getLogger(TokenSaverProvisionService.class);

    private static final String SOURCE_TYPE_TOKEN_SAVER = "TOKEN_SAVER";

    private static final String DEFAULT_MODEL_DISPLAY_NAME = "TokenSaver Model";

    private static final String DEFAULT_MODEL_CODE = "token-saver-model";

    @Autowired
    private ByaiSystemConfigService systemConfigService;

    @Autowired
    private ByaiAimodelMapper byaiAimodelMapper;

    @Autowired
    private ModelManagementApplicationService modelManagementApplicationService;

    private final RestTemplate restTemplate = new RestTemplate();

    /**
     * 用户登录时检查并自动分配 TokenSaver 模型
     *
     * @param userId   用户ID
     * @param userCode 用户工号
     */
    @SuppressWarnings("unchecked")
    public void provisionIfNeeded(Long userId, String userCode) {
        try {
            String json = systemConfigService.getDcSystemConfigValueByCode("MODEL_QUOTA");
            if (json == null || json.trim().isEmpty()) {
                return;
            }
            JSONObject config = JSON.parseObject(json);
            JSONObject tokenSaver = config.getJSONObject("tokenSaver");
            if (tokenSaver == null || !tokenSaver.getBooleanValue("enabled")) {
                return;
            }

            LambdaQueryWrapper<ByaiAimodel> query = new LambdaQueryWrapper<>();
            query.eq(ByaiAimodel::getCreateBy, userId)
                 .eq(ByaiAimodel::getSourceType, SOURCE_TYPE_TOKEN_SAVER);
            Long count = byaiAimodelMapper.selectCount(query);
            if (count != null && count > 0) {
                return;
            }

            String apiUrl = tokenSaver.getString("apiUrl");
            if (apiUrl == null || apiUrl.trim().isEmpty()) {
                log.warn("MODEL_QUOTA.tokenSaver.apiUrl 未配置，跳过 TokenSaver 模型分配");
                return;
            }

            String modelCode = tokenSaver.getString("modelCode");

            Map<String, Object> modelConfig = callTokenSaverApi(apiUrl, userCode);
            if (modelConfig == null) {
                log.warn("TokenSaver API 返回空，用户={}", userCode);
                return;
            }

            ModelUpsertRequest upsertRequest = new ModelUpsertRequest();
            upsertRequest.setDisplayName(getStringOrDefault(modelConfig, "modelName", DEFAULT_MODEL_DISPLAY_NAME));
            upsertRequest.setModelCode(getStringOrDefault(modelConfig, "modelCode",
                    (modelCode != null && !modelCode.isEmpty()) ? modelCode : DEFAULT_MODEL_CODE));
            upsertRequest.setApiEndpoint(getStringOrDefault(modelConfig, "apiEndpoint", ""));
            upsertRequest.setApiToken(getStringOrDefault(modelConfig, "apiKey", ""));
            upsertRequest.setModelType("LLM");
            upsertRequest.setModelProtocol(getStringOrDefault(modelConfig, "modelProtocol", "OpenAI"));
            upsertRequest.setStatus("ENABLED");
            upsertRequest.setOwnerType("PERSONAL");
            upsertRequest.setAbilities(new ArrayList<>(List.of("3")));

            modelManagementApplicationService.upsertModel(upsertRequest, userId);

            LambdaQueryWrapper<ByaiAimodel> findNew = new LambdaQueryWrapper<>();
            findNew.eq(ByaiAimodel::getCreateBy, userId)
                   .eq(ByaiAimodel::getModelNo, upsertRequest.getModelCode())
                   .orderByDesc(ByaiAimodel::getCreateTime)
                   .last("LIMIT 1");
            ByaiAimodel inserted = byaiAimodelMapper.selectOne(findNew);
            if (inserted != null) {
                inserted.setSourceType(SOURCE_TYPE_TOKEN_SAVER);
                byaiAimodelMapper.updateById(inserted);
            }

            log.info("TokenSaver 模型分配成功，用户={}, modelCode={}", userCode, upsertRequest.getModelCode());

        } catch (Exception e) {
            log.warn("TokenSaver 模型分配失败，用户={}: {}", userCode, e.getMessage());
        }
    }

    /**
     * 调用 TokenSaver API 获取模型配置
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> callTokenSaverApi(String apiUrl, String userCode) {
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
            if (respBody.containsKey("data") && respBody.get("data") instanceof Map) {
                return (Map<String, Object>) respBody.get("data");
            }
            return respBody;
        } catch (Exception e) {
            log.warn("调用 TokenSaver API 失败: {}", e.getMessage());
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
