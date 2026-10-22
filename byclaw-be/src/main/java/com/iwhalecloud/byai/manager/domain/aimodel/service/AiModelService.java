package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.aimodel.ModelManagementApplicationService;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;

import java.util.List;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 提供模型缓存查询，并在单模型缓存未命中时从数据库恢复启用模型。
 */
@Slf4j
@Service
public class AiModelService {

    /**
     * 默认模型 ID 查询服务。
     */
    @Autowired
    private ModelManagementApplicationService modelManagementApplicationService;

    /**
     * 模型数据库查询及缓存同步服务。
     */
    @Autowired
    private ByaiAimodelDomainService byaiAimodelDomainService;

    /**
     * 从 Redis 获取模型列表。
     *
     * @return 模型列表
     */
    public List<ModelDto> getModelList() {
        List<Object> objects = RedisUtil.hmGetAll(RedisConfig.AI_MODEL_KEY);
        return JsonUtil.parseArray(JsonUtil.toJSONString(objects), ModelDto.class);
    }

    /**
     * 按模型 ID 查询启用模型。优先读取 Redis；缓存未命中时查库并回填缓存。
     *
     * @param relModelId 模型 ID
     * @return 模型信息；ID 无效、模型不存在或未启用时返回 null
     */
    public ModelDto getModel(String relModelId) {

        String json = RedisUtil.hmGet(RedisConfig.AI_MODEL_KEY, relModelId);
        if (StringUtil.isNotEmpty(json)) {
            return JsonUtil.parseObject(json, ModelDto.class);
        }


        log.error("从数据获取模型信息: modelId={}", relModelId);

        // 如果没有，从数据为兜底
        ByaiAimodel byaiAimodel = byaiAimodelDomainService.getById(Long.valueOf(relModelId));
        if (byaiAimodel != null) {
            byaiAimodelDomainService.syncToRedis(byaiAimodel);
            return byaiAimodelDomainService.toModelDto(byaiAimodel);
        }
        else {
            log.error("数据库获取模型失败: modelId={}", relModelId);
            return null;
        }

    }

    /**
     * 查询默认聊天模型，并从 Redis 获取模型信息。
     *
     * @return 默认聊天模型信息
     */
    public ModelDto getDefaultChatModel() {
        String modelId = modelManagementApplicationService.getDefaultModelId();
        String json = RedisUtil.hmGet(RedisConfig.AI_MODEL_KEY, modelId);
        return JsonUtil.parseObject(json, ModelDto.class);
    }

}
