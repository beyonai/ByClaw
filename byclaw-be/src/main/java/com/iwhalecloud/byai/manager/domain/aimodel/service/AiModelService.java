package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
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
        List<Object> objects = RedisUtil.hmGetAll(RedisConfig.AI_MODEL_KEY);
        return JsonUtil.parseArray(JsonUtil.toJSONString(objects), ModelDto.class);
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
