package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import java.util.ArrayList;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class AiModelService {

    @Autowired
    private ModelManagementApplicationService modelManagementApplicationService;

    public List<ModelDto> getModelList() {
        List<Object> values = RedisUtil.hmGetAll(RedisConfig.AI_MODEL_KEY);
        if (values == null || values.isEmpty()) {
            return List.of();
        }
        List<ModelDto> models = new ArrayList<>();
        for (Object value : values) {
            if (value == null || (value instanceof String text && text.isBlank())) {
                continue;
            }
            try {
                // Hash values are individual JSON strings, not a JSON array of model objects.
                String json = value instanceof String text ? text : JsonUtil.toJSONString(value);
                ModelDto model = JSON.parseObject(json, ModelDto.class);
                if (model != null) {
                    models.add(model);
                }
            } catch (RuntimeException error) {
                // Parser messages can contain the original config, including tokens and headers.
                log.warn("Skipping invalid cached model record; valueType={}, errorType={}",
                    value.getClass().getSimpleName(), error.getClass().getSimpleName());
            }
        }
        return models;
    }

    public ModelDto getModel(String relModelId) {
        String json = RedisUtil.hmGet(RedisConfig.AI_MODEL_KEY, relModelId);
        return JsonUtil.parseObject(json, ModelDto.class);
    }

    public ModelDto getDefaultChatModel() {
        String modelId = modelManagementApplicationService.getDefaultModelId();
        String json = RedisUtil.hmGet(RedisConfig.AI_MODEL_KEY, modelId);
        return JsonUtil.parseObject(json, ModelDto.class);
    }

}
