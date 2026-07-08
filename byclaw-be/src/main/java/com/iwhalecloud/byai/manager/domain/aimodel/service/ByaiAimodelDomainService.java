package com.iwhalecloud.byai.manager.domain.aimodel.service;

import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelStatusEnum;
import com.iwhalecloud.byai.manager.domain.tag.service.ByaiTagRelationService;
import com.iwhalecloud.byai.manager.qo.aimodel.DefaultAiModelQo;
import com.iwhalecloud.byai.manager.qo.aimodel.FindAiModelQo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelRequest;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 模型定义领域服务（byai_aimodel） 负责分页查询、按 ID 查询、新增/更新、删除、设置状态及与 Redis 联动
 *
 * @author system
 */
@Service
@Slf4j
public class ByaiAimodelDomainService {

    private static final Long DEFAULT_MODEL_TAG_ID = 1L;

    @Autowired
    private ByaiAimodelMapper byaiAimodelMapper;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private ByaiTagRelationService byaiTagRelationService;

    /**
     * 按条件分页查询（使用 PageHelper 实现分页，与项目现有分页方式一致）
     *
     * @param request 列表请求（pageNum、pageSize、status、ability、system、modelId、modelName、keyword）
     * @return PageInfo（list、pageNum、pageSize、total、totalPages）
     */
    public PageInfo<ByaiAimodel> listByCondition(ModelListRequest request) {
        int pageNum = request.getPageNum() == null || request.getPageNum() < 1 ? 1 : request.getPageNum();
        int pageSize = request.getPageSize() == null || request.getPageSize() < 1 ? 10 : request.getPageSize();

        String statusDb = ModelStatusEnum.toDbCode(request.getStatus());
        Long modelIdLong = null;
        if (StringUtil.isNotEmpty(request.getModelId())) {
            try {
                modelIdLong = Long.parseLong(request.getModelId());
            }
            catch (NumberFormatException e) {
                log.warn("modelId parse fail, modelId={}", request.getModelId());
            }
        }

        PageHelper.startPage(pageNum, pageSize);
        List<ByaiAimodel> list = byaiAimodelMapper.selectByCondition(statusDb, request.getAbility(),
            request.getSystem(), modelIdLong, request.getModelName(), request.getKeyword(), request.getCreateBy(),
            request.getOwnerType());
        com.github.pagehelper.PageInfo<ByaiAimodel> phPageInfo = new com.github.pagehelper.PageInfo<>(list);
        return PageHelperUtil.toPageInfo(phPageInfo);
    }

    /**
     * 判断模型名称是否已被占用：新增时 excludeModelId 传 null（存在同名即占用）；修改时传当前 id（存在其他记录同名即占用）
     *
     * @param modelName 模型名称（displayName 对应 model_name），建议调用方先 trim
     * @param excludeModelId 排除的模型 ID，为 null 时统计所有同名
     * @return true 表示名称已被占用，不允许保存
     */
    public boolean existsByModelNameExcludeId(String modelName, Long excludeModelId) {
        if (StringUtil.isEmpty(modelName)) {
            return false;
        }
        return byaiAimodelMapper.countByModelNameExcludeId(modelName.trim(), excludeModelId) > 0;
    }

    /**
     * 按主键查询
     *
     * @param modelId 模型 ID
     * @return 实体，不存在返回 null
     */
    public ByaiAimodel getById(Long modelId) {
        if (modelId == null) {
            return null;
        }
        return byaiAimodelMapper.selectById(modelId);
    }

    /**
     * 新增或更新（由调用方保证 id 为空为新增、有值为更新） 启用状态（OOA）时同步写入 Redis
     *
     * @param entity 实体（新增时 modelId 由本方法填充）
     * @return 主键 ID
     */
    public Long upsert(ByaiAimodel entity) {
        if (entity.getModelId() == null) {
            entity.setModelId(SequenceService.nextVal());
            byaiAimodelMapper.insert(entity);
        }
        else {
            byaiAimodelMapper.updateById(entity);
        }
        if (ModelStatusEnum.isEnabledDb(entity.getStatus())) {
            syncToRedis(entity);
        }
        else {
            removeFromRedis(entity.getModelId());
        }
        return entity.getModelId();
    }

    /**
     * 按主键删除，并从 Redis 移除
     *
     * @param modelId 模型 ID
     */
    public void deleteById(Long modelId) {
        if (modelId == null) {
            return;
        }
        byaiAimodelMapper.deleteById(modelId);
        removeFromRedis(modelId);
    }

    /**
     * 设置状态；启用时写入 Redis，停用时从 Redis 移除
     *
     * @param modelId 模型 ID
     * @param apiStatus API 状态（ENABLED/DISABLED/TESTING）
     */
    public void setStatus(Long modelId, String apiStatus) {
        if (modelId == null || StringUtil.isEmpty(apiStatus)) {
            return;
        }
        ByaiAimodel entity = byaiAimodelMapper.selectById(modelId);
        if (entity == null) {
            return;
        }
        String dbCode = ModelStatusEnum.toDbCode(apiStatus);
        if (dbCode == null) {
            return;
        }
        entity.setStatus(dbCode);
        byaiAimodelMapper.updateById(entity);
        if (ModelStatusEnum.isEnabledDb(dbCode)) {
            syncToRedis(entity);
        }
        else {
            removeFromRedis(modelId);
        }
    }

    /**
     * 启用状态模型写入 Redis（与现有 AI_MODEL_KEY、ModelDto 格式兼容）
     */
    public void syncToRedis(ByaiAimodel entity) {
        if (entity == null || entity.getModelId() == null) {
            return;
        }
        ModelDto dto = toModelDto(entity);
        RedisUtil.hmPut(RedisConfig.AI_MODEL_KEY, String.valueOf(entity.getModelId()), JsonUtil.toJSONString(dto));
        rebuildTypeList();
    }

    /**
     * 从 Redis 移除指定 modelId 的缓存（停用/删除时调用）
     */
    public void removeFromRedis(Long modelId) {
        if (modelId == null) {
            return;
        }
        RedisUtil.hmDelete(RedisConfig.AI_MODEL_KEY, String.valueOf(modelId));
        rebuildTypeList();
    }

    /**
     * 根据 AI_MODEL_KEY 中的全量数据，按 modelType 分组重建 AI_MODEL_TYPE_KEY
     */
    private void rebuildTypeList() {
        try {
            List<Object> allValues = RedisUtil.hmGetAll(RedisConfig.AI_MODEL_KEY);
            Map<String, List<ModelDto>> typeMap = new HashMap<>();
            if (allValues != null) {
                for (Object val : allValues) {
                    if (val == null) {
                        continue;
                    }
                    ModelDto dto = JsonUtil.parseObject(val.toString(), ModelDto.class);
                    if (dto != null && StringUtil.isNotEmpty(dto.getModelType())) {
                        typeMap.computeIfAbsent(dto.getModelType(), k -> new ArrayList<>()).add(dto);
                    }
                }
            }
            // 先删除旧的 type list key，再写入新的
            RedisUtil.del(RedisConfig.AI_MODEL_TYPE_KEY);
            if (!typeMap.isEmpty()) {
                Map<String, String> entries = new HashMap<>(typeMap.size());
                for (Map.Entry<String, List<ModelDto>> entry : typeMap.entrySet()) {
                    List<ModelDto> models = normalizeDefaultOrder(entry.getValue());
                    entries.put(entry.getKey(), JsonUtil.toJSONString(models));
                }
                RedisUtil.hmPutAll(RedisConfig.AI_MODEL_TYPE_KEY, entries);
            }
        }
        catch (Exception e) {
            log.error("rebuildTypeList fail", e);
        }
    }

    /**
     * ByaiAimodel 转 ModelDto（供 Redis 存储，与现有消费者格式一致；Token 解密后写入供调用方使用）
     */
    private ModelDto toModelDto(ByaiAimodel entity) {
        ModelDto dto = new ModelDto();
        dto.setInstanceId(String.valueOf(entity.getModelId()));
        dto.setUrl(entity.getUrl());
        dto.setAuthToken(decryptTokenSafely(entity.getAuthToken()));
        dto.setModelCode(entity.getModelNo());
        dto.setModelName(entity.getModelName());
        dto.setModelType(entity.getModelType());
        dto.setIsDefault(resolveDefaultFlag(entity));
        dto.setMaxContentToken(
            entity.getMaxContentToken() != null ? String.valueOf(entity.getMaxContentToken()) : null);
        dto.setStatus("OOA".equals(entity.getStatus()) ? 1 : 0);
        if (StringUtil.isNotEmpty(entity.getInParams())) {
            try {
                JSONObject jo = JSONObject.parseObject(entity.getInParams());
                dto.setInstanceParam(jo != null ? jo : new HashMap<>());
            }
            catch (Exception e) {
                log.debug("inParams parse to map fail, inParams={}", entity.getInParams());
                dto.setInstanceParam(new HashMap<>());
            }
        }
        return dto;
    }

    private Integer resolveDefaultFlag(ByaiAimodel entity) {
        if (entity.getIsDefault() != null) {
            return entity.getIsDefault();
        }
        if (entity.getModelId() == null) {
            return 0;
        }
        return byaiTagRelationService.findTagRelation(Constants.OBJ_TYPE_AIMODEL, DEFAULT_MODEL_TAG_ID).stream()
            .anyMatch(rel -> entity.getModelId().equals(rel.getObjId())) ? 1 : 0;
    }

    private List<ModelDto> normalizeDefaultOrder(List<ModelDto> models) {
        if (models == null || models.isEmpty()) {
            return List.of();
        }
        ModelDto selectedDefault = null;
        for (ModelDto dto : models) {
            if (selectedDefault == null && dto != null && Integer.valueOf(1).equals(dto.getIsDefault())) {
                selectedDefault = dto;
            }
        }
        if (selectedDefault != null) {
            for (ModelDto dto : models) {
                if (dto != null) {
                    dto.setIsDefault(dto == selectedDefault ? 1 : 0);
                }
            }
        }
        models.sort(Comparator.comparing((ModelDto dto) -> !Integer.valueOf(1).equals(dto.getIsDefault()))
            .thenComparing(dto -> dto.getInstanceId() == null ? "" : dto.getInstanceId()));
        return models;
    }

    /**
     * 解密 Token（库中为加密）；解密失败时返回原值（兼容历史未加密数据）
     */
    private String decryptTokenSafely(String encrypted) {
        if (encrypted == null || encrypted.isEmpty()) {
            return encrypted;
        }
        try {
            return Sm4Util.decrypt(encrypted);
        }
        catch (Exception e) {
            log.debug("aimodel token decrypt fail, use original");
            return encrypted;
        }
    }

    public List<ByaiAimodel> listModel(ModelRequest request) {
        if (request.getTagId() == null) {
            return Collections.emptyList();
        }
        return byaiAimodelMapper.listModel(request);
    }

    /**
     * 列出默认模型
     *
     * @param defaultAiModelQo 模型管理
     * @return ByaiAimodel
     */
    public ByaiAimodel getDefaultAiModel(DefaultAiModelQo defaultAiModelQo) {
        List<ByaiAimodel> byaiAiModels = byaiAimodelMapper.listDefaultAiModel(defaultAiModelQo);
        return ListUtil.isNotEmpty(byaiAiModels) ? byaiAiModels.getFirst() : null;
    }

    /**
     * 按条件查询单个模型（非空字段参与等值匹配）。
     *
     * @param findAiModelQo 查询条件
     * @return 匹配的模型，不存在返回 null
     */
    public List<ByaiAimodel> findAiModelByQo(FindAiModelQo findAiModelQo) {
        if (findAiModelQo == null) {
            return null;
        }
        LambdaQueryWrapper<ByaiAimodel> queryWrapper = new LambdaQueryWrapper<>();
        if (findAiModelQo.getModelId() != null) {
            queryWrapper.eq(ByaiAimodel::getModelId, findAiModelQo.getModelId());
        }
        if (StringUtil.isNotEmpty(findAiModelQo.getModelType())) {
            queryWrapper.eq(ByaiAimodel::getModelType, findAiModelQo.getModelType());
        }
        if (StringUtil.isNotEmpty(findAiModelQo.getModelNo())) {
            queryWrapper.eq(ByaiAimodel::getModelNo, findAiModelQo.getModelNo());
        }
        if (StringUtil.isNotEmpty(findAiModelQo.getModelProtocol())) {
            queryWrapper.eq(ByaiAimodel::getModelProtocol, findAiModelQo.getModelProtocol());
        }
        if (StringUtil.isNotEmpty(findAiModelQo.getOwnerType())) {
            queryWrapper.eq(ByaiAimodel::getOwnerType, findAiModelQo.getOwnerType());
        }
        if (StringUtil.isNotEmpty(findAiModelQo.getSourceType())) {
            queryWrapper.eq(ByaiAimodel::getSourceType, findAiModelQo.getSourceType());
        }
        if (findAiModelQo.getCreateBy() != null) {
            queryWrapper.eq(ByaiAimodel::getCreateBy, findAiModelQo.getCreateBy());
        }
        if (StringUtil.isNotEmpty(findAiModelQo.getStatus())) {
            queryWrapper.eq(ByaiAimodel::getStatus, findAiModelQo.getStatus());
        }
        return byaiAimodelMapper.selectList(queryWrapper);
    }

}
