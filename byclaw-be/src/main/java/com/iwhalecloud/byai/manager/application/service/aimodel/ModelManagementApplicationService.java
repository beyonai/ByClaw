package com.iwhalecloud.byai.manager.application.service.aimodel;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.toolkit.CollectionUtils;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelStatusEnum;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.domain.tag.service.ByaiTagRelationService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListResponse;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelUpsertRequest;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelVO;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.constants.Constants;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.MapUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 模型管理应用服务
 * 编排列表、upsert、删除、setStatus、详情、调试等用例；调用 domain.aimodel，编排事务与审计
 *
 * @author system
 */
@Service
@Slf4j
public class
ModelManagementApplicationService {


    private static final int MASK_PREFIX_LEN = 3;
    private static final int MASK_SUFFIX_LEN = 4;

    @Autowired
    private ByaiAimodelDomainService byaiAimodelDomainService;

    @Autowired
    private ByaiTagRelationService byaiTagRelationService;

    /**
     * 分页列表（列表仅返回 apiTokenMasked，不返回明文 apiToken）
     */
    public ModelListResponse getModelListByPage(ModelListRequest request) {
        PageInfo<ByaiAimodel> page = byaiAimodelDomainService.listByCondition(request);
        List<ModelVO> rows = page.getList() == null ? List.of()
            : page.getList().stream()
                .map(e -> entityToModelVO(e, true))
                .collect(Collectors.toList());
        ModelListResponse response = new ModelListResponse();
        response.setRows(rows);
        response.setPageIndex(page.getPageNum());
        response.setPageSize(page.getPageSize());
        response.setTotal(page.getTotal());
        return response;
    }

    /**
     * 模型详情（详情可返回 apiToken 供编辑回显；按安全策略可改为仅返回 apiTokenMasked + hasApiToken）
     */
    public ModelVO getModelDetail(String id) {
        Long modelId = parseModelId(id);
        ByaiAimodel entity = byaiAimodelDomainService.getById(modelId);
        if (entity == null) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40004, "aimodel.not.found");
        }
        return entityToModelVO(entity, false);
    }

    /**
     * 新增/更新模型；apiToken 加密存储；敏感数据编辑建议由调用方记录审计日志
     */
    @Transactional(rollbackFor = Exception.class)
    public Map<String, String> upsertModel(ModelUpsertRequest request, Long currentUserId) {
        validateUpsertRequest(request);
        // 模型名称唯一性校验：新增时名称已存在则拒绝；修改时新名称已被其他记录占用则拒绝
        String displayName = request.getDisplayName() != null ? request.getDisplayName().trim() : "";
        if (StringUtil.isNotEmpty(displayName)) {
            if (StringUtil.isEmpty(request.getId())) {
                if (byaiAimodelDomainService.existsByModelNameExcludeId(displayName, null)) {
                    throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40002, "aimodel.name.duplicate");
                }
            } else {
                Long modelId = parseModelId(request.getId());
                if (byaiAimodelDomainService.existsByModelNameExcludeId(displayName, modelId)) {
                    throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40002, "aimodel.name.duplicate");
                }
            }
        }
        // 敏感数据编辑可在此记录审计日志（如调用 AuditApplicationService）
        ByaiAimodel entity;
        if (StringUtil.isNotEmpty(request.getId())) {
            Long modelId = parseModelId(request.getId());
            ByaiAimodel existing = byaiAimodelDomainService.getById(modelId);
            if (existing == null) {
                throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40004, "aimodel.not.found");
            }
            entity = requestToEntity(request, currentUserId);
            entity.setModelId(modelId);
            entity.setCreateBy(existing.getCreateBy());
            entity.setCreateTime(existing.getCreateTime());
        } else {
            entity = requestToEntity(request, currentUserId);
        }
        Long modelId = byaiAimodelDomainService.upsert(entity);

        // Story 一体化保存：abilities 非空时，将模型 id 与每个 ability 联合写入 byai_tag_relation（先删后插）
        if (request.getAbilities() != null && !request.getAbilities().isEmpty()) {
            byaiTagRelationService.saveAimodelAbilities(modelId, request.getAbilities(), currentUserId);
        }

        Map<String, String> data = new HashMap<>(1);
        data.put("id", String.valueOf(modelId));
        return data;
    }

    /**
     * 删除模型；启用中的模型不允许删除，需先停用后再删。
     */
    @Transactional(rollbackFor = Exception.class)
    public Boolean deleteModel(String id) {
        Long modelId = parseModelId(id);
        ByaiAimodel entity = byaiAimodelDomainService.getById(modelId);
        if (entity == null) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40004, "aimodel.not.found");
        }
        if (ModelStatusEnum.isEnabledDb(entity.getStatus())) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.delete.enabled.forbidden");
        }
        byaiAimodelDomainService.deleteById(modelId);
        return Boolean.TRUE;
    }

    /**
     * 设置状态（ENABLED/DISABLED）
     */
    @Transactional(rollbackFor = Exception.class)
    public Boolean setModelStatus(String id, String status) {
        Long modelId = parseModelId(id);
        ByaiAimodel entity = byaiAimodelDomainService.getById(modelId);
        if (entity == null) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40004, "aimodel.not.found");
        }
        if (!ModelStatusEnum.ENABLED.name().equals(status) && !ModelStatusEnum.DISABLED.name().equals(status)) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.status.invalid");
        }
        byaiAimodelDomainService.setStatus(modelId, status);
        return Boolean.TRUE;
    }

    /**
     * 从调试请求体中解析可选模型主键 id（与 Story 约定一致：请求体顶层字段 id）。
     *
     * @param body 调试接口请求体
     * @return 解析出的模型 ID，空或非法则返回 null（不更新状态）
     */
    public Long parseModelIdFromBody(Map<String, Object> body) {
        if (body == null || body.isEmpty()) {
            return null;
        }
        Object idObj = body.get("id");
        if (idObj == null) {
            return null;
        }
        if (idObj instanceof Number) {
            long v = ((Number) idObj).longValue();
            return v > 0 ? v : null;
        }
        String idStr = idObj.toString();
        if (StringUtil.isEmpty(idStr)) {
            return null;
        }
        try {
            long v = Long.parseLong(idStr.trim());
            return v > 0 ? v : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * 按调试结果更新模型状态（Story：调试成功 OOA+Redis，调试失败 OOD 并从 Redis 移除）。
     * 仅作副作用调用，失败仅打日志，不改变调试接口响应。
     *
     * @param modelId 模型主键，为 null 时不更新
     * @param success 调试是否成功
     */
    public void updateModelStatusAfterDebug(Long modelId, boolean success) {
        if (modelId == null) {
            return;
        }
        try {
            String apiStatus = success ? ModelStatusEnum.ENABLED.name() : ModelStatusEnum.TESTING.name();
            byaiAimodelDomainService.setStatus(modelId, apiStatus);
        } catch (Exception e) {
            log.warn("aimodel debug status update fail, modelId={}, success={}", modelId, success, e);
        }
    }








    private Long parseModelId(String id) {
        if (StringUtil.isEmpty(id)) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.id.required");
        }
        try {
            return Long.parseLong(id);
        }
        catch (NumberFormatException e) {
            log.error("aimodel id parse fail, message={}", e.getMessage(), e);
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.id.invalid");
        }
    }

    private void validateUpsertRequest(ModelUpsertRequest request) {
        if (request == null || StringUtil.isEmpty(request.getDisplayName())
            || StringUtil.isEmpty(request.getModelCode()) || StringUtil.isEmpty(request.getApiEndpoint())
            || StringUtil.isEmpty(request.getApiToken())) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.upsert.required");
        }
        if (request.getContextTokens() == null || request.getContextTokens() < 1) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.contextTokens.required");
        }
    }

    /**
     * Entity 转 ModelVO；forList=true 仅返回 apiTokenMasked，不返回 apiToken。
     * 规范要求：详情与列表接口均须从实体 in_params 解析并组装扩展字段（providerName、abilities、systems、headers、超时/重试/高级参数、updatedAt）到响应，供前端编辑回显与展示。
     */
    private ModelVO entityToModelVO(ByaiAimodel entity, boolean forList) {
        ModelVO vo = new ModelVO();
        fillModelVOBasic(vo, entity, forList);
        if (StringUtil.isNotEmpty(entity.getInParams())) {
            fillModelVOFromInParams(vo, entity.getInParams());
        }
        return vo;
    }

    /** 填充 ModelVO 基础字段（id、displayName、modelCode、status、token 等） */
    private void fillModelVOBasic(ModelVO vo, ByaiAimodel entity, boolean forList) {
        vo.setId(entity.getModelId() != null ? String.valueOf(entity.getModelId()) : null);
        vo.setDisplayName(entity.getModelName());
        /// 先设置为model_name
        vo.setModelCode(entity.getModelNo());
        vo.setModelType(entity.getModelType());
        vo.setStatus(ModelStatusEnum.toApiStatus(entity.getStatus()));
        vo.setContextTokens(entity.getMaxContentToken());
        vo.setApiEndpoint(entity.getUrl());
        vo.setApiTokenMasked(maskToken(entity.getAuthToken()));
        if (!forList && entity.getAuthToken() != null) {
            vo.setApiToken(decryptTokenSafely(entity.getAuthToken()));
        }
        vo.setUpdatedAt(entity.getCreateTime() != null ? formatUpdatedAt(entity.getCreateTime()) : null);
        vo.setInparamTemplate(entity.getInparamTemplate());
    }

    /** 从 in_params JSON 解析并填充 ModelVO 扩展字段；解析失败仅打日志不抛异常 */
    private void fillModelVOFromInParams(ModelVO vo, String inParamsJson) {
        try {
            Map<String, Object> inParams = JSONObject.parseObject(inParamsJson);
            if (inParams == null) {
                return;
            }
            setVoInParamsStrings(vo, inParams);
            setVoInParamsNumbers(vo, inParams);
            setVoInParamsUpdatedAt(vo, inParams);
        } catch (Exception e) {
            log.error("inParams to ModelVO fail, inParams={}", inParamsJson, e);
        }
    }

    /** 从 inParams 填充字符串/列表类字段：providerName、abilities、systems、headers */
    private void setVoInParamsStrings(ModelVO vo, Map<String, Object> inParams) {
        if (inParams.get("providerName") != null) {
            vo.setProviderName(String.valueOf(inParams.get("providerName")));
        }
        if (inParams.get("abilities") != null) {
            vo.setAbilities(JSON.parseArray(JSON.toJSONString(inParams.get("abilities")), String.class));
        }
        if (inParams.get("systems") != null) {
            vo.setSystems(JSON.parseArray(JSON.toJSONString(inParams.get("systems")), String.class));
        }
        if (inParams.get("headers") != null) {
            vo.setHeaders(parseHeaders(inParams.get("headers")));
        }
    }

    /** 从 inParams 填充数值类字段：超时、重试、采样参数等 */
    private void setVoInParamsNumbers(ModelVO vo, Map<String, Object> inParams) {
        setVoInParamsInts(vo, inParams);
        setVoInParamsDoubles(vo, inParams);
    }

    /** 从 inParams 填充整型：超时、重试、maxTokens */
    private void setVoInParamsInts(ModelVO vo, Map<String, Object> inParams) {
        if (inParams.get("connectTimeoutSec") != null) {
            vo.setConnectTimeoutSec(((Number) inParams.get("connectTimeoutSec")).intValue());
        }
        if (inParams.get("readTimeoutSec") != null) {
            vo.setReadTimeoutSec(((Number) inParams.get("readTimeoutSec")).intValue());
        }
        if (inParams.get("maxRetries") != null) {
            vo.setMaxRetries(((Number) inParams.get("maxRetries")).intValue());
        }
        if (inParams.get("retryIntervalSec") != null) {
            vo.setRetryIntervalSec(((Number) inParams.get("retryIntervalSec")).intValue());
        }
        if (inParams.get("maxTokens") != null) {
            vo.setMaxTokens(((Number) inParams.get("maxTokens")).intValue());
        }
    }

    /** 从 inParams 填充浮点型：temperature、topP、frequencyPenalty、presencePenalty */
    private void setVoInParamsDoubles(ModelVO vo, Map<String, Object> inParams) {
        if (inParams.get("temperature") != null) {
            vo.setTemperature(((Number) inParams.get("temperature")).doubleValue());
        }
        if (inParams.get("topP") != null) {
            vo.setTopP(((Number) inParams.get("topP")).doubleValue());
        }
        if (inParams.get("frequencyPenalty") != null) {
            vo.setFrequencyPenalty(((Number) inParams.get("frequencyPenalty")).doubleValue());
        }
        if (inParams.get("presencePenalty") != null) {
            vo.setPresencePenalty(((Number) inParams.get("presencePenalty")).doubleValue());
        }
    }

    /** 从 inParams 填充 updatedAt */
    private void setVoInParamsUpdatedAt(ModelVO vo, Map<String, Object> inParams) {
        if (inParams.get("updatedAt") != null) {
            vo.setUpdatedAt(String.valueOf(inParams.get("updatedAt")));
        }
    }

    private List<Map<String, String>> parseHeaders(Object headersObj) {
        if (headersObj == null) {
            return null;
        }
        String json = JSON.toJSONString(headersObj);
        JSONArray arr = JSON.parseArray(json);
        if (arr == null || arr.isEmpty()) {
            return null;
        }
        List<Map<String, String>> result = new java.util.ArrayList<>(arr.size());
        for (int i = 0; i < arr.size(); i++) {
            Map<String, Object> ob = arr.getJSONObject(i);
            Map<String, String> entry = new HashMap<>(2);
            if (ob != null) {
                entry.put("key", MapUtils.getString(ob, "key"));
                entry.put("value", MapUtils.getString(ob, "value"));
            }
            result.add(entry);
        }
        return result;
    }

    private String formatUpdatedAt(Date date) {
        if (date == null) {
            return null;
        }
        return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).format(date);
    }

    private String maskToken(String token) {
        if (token == null || token.length() <= MASK_PREFIX_LEN + MASK_SUFFIX_LEN) {
            return token != null && token.length() > 0 ? "****" : null;
        }
        return token.substring(0, Math.min(MASK_PREFIX_LEN, token.length()))
            + "****"
            + token.substring(token.length() - Math.min(MASK_SUFFIX_LEN, token.length()));
    }

    /**
     * 解密 Token（存储为加密）；解密失败时返回原值（兼容历史未加密数据）
     */
    private String decryptTokenSafely(String encrypted) {
        if (encrypted == null || encrypted.isEmpty()) {
            return encrypted;
        }
        try {
            return Sm4Util.decrypt(encrypted);
        } catch (Exception e) {
            log.debug("aimodel token decrypt fail, use original");
            return encrypted;
        }
    }

    /**
     * ModelUpsertRequest 转 ByaiAimodel；abilities、systems、headers、超时等写入 inParams JSON
     */
    private ByaiAimodel requestToEntity(ModelUpsertRequest request, Long currentUserId) {
        ByaiAimodel entity = new ByaiAimodel();
        Long modelId = parseModelIdOrNull(request.getId());
        fillEntityBasicFields(entity, request, modelId);
        Map<String, Object> inParams = buildInParamsFromRequest(request, modelId);
        if (!inParams.isEmpty()) {
            entity.setInParams(JsonUtil.toJSONString(inParams));
        }
        if (modelId == null) {
            setEntityCreateInfo(entity, currentUserId);
        }
        return entity;
    }

    /** 解析请求中的模型ID，无效或为空则返回 null（表示新增）；不抛异常 */
    private Long parseModelIdOrNull(String id) {
        if (StringUtil.isEmpty(id)) {
            return null;
        }
        try {
            return Long.parseLong(id);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    /** 填充实体基本字段（表字段及 Token 加密）；providerName/abilities 等由 buildInParamsFromRequest 写入 in_params */
    private void fillEntityBasicFields(ByaiAimodel entity, ModelUpsertRequest request, Long modelId) {
        entity.setModelId(modelId);
        entity.setModelName(request.getDisplayName());
        entity.setModelNo(request.getModelCode());
        entity.setModelType(request.getModelType() != null ? request.getModelType() : "LLM");
        entity.setStatus(ModelStatusEnum.toDbCode(request.getStatus() != null ? request.getStatus() : ModelStatusEnum.DISABLED.name()));
        entity.setUrl(request.getApiEndpoint());
        entity.setAuthToken(Sm4Util.encrypt(request.getApiToken()));
        entity.setMaxContentToken(request.getContextTokens());
        entity.setInparamTemplate(request.getInparamTemplate());
    }

    /** 构建 in_params Map：providerName、abilities、systems、headers、超时/重试/采样参数及 updatedAt */
    private Map<String, Object> buildInParamsFromRequest(ModelUpsertRequest request, Long modelId) {
        Map<String, Object> inParams = new HashMap<>();
        putIfNonEmpty(inParams, "providerName", request.getProviderName());
        putIfNonEmptyCollection(inParams, "abilities", request.getAbilities());
        putIfNonEmptyCollection(inParams, "systems", request.getSystems());
        putIfNonEmptyCollection(inParams, "headers", request.getHeaders());
        putIfNonNull(inParams, "connectTimeoutSec", request.getConnectTimeoutSec());
        putIfNonNull(inParams, "readTimeoutSec", request.getReadTimeoutSec());
        putIfNonNull(inParams, "maxRetries", request.getMaxRetries());
        putIfNonNull(inParams, "retryIntervalSec", request.getRetryIntervalSec());
        putIfNonNull(inParams, "temperature", request.getTemperature());
        putIfNonNull(inParams, "topP", request.getTopP());
        putIfNonNull(inParams, "maxTokens", request.getMaxTokens());
        putIfNonNull(inParams, "frequencyPenalty", request.getFrequencyPenalty());
        putIfNonNull(inParams, "presencePenalty", request.getPresencePenalty());
        if (modelId != null) {
            inParams.put("updatedAt", formatUpdatedAt(new Date()));
        }
        return inParams;
    }

    private void putIfNonEmpty(Map<String, Object> map, String key, String value) {
        if (value != null && !value.isEmpty()) {
            map.put(key, value);
        }
    }

    private void putIfNonEmptyCollection(Map<String, Object> map, String key, Object value) {
        if (value != null && (value instanceof List ? !((List<?>) value).isEmpty() : true)) {
            map.put(key, value);
        }
    }

    private void putIfNonNull(Map<String, Object> map, String key, Object value) {
        if (value != null) {
            map.put(key, value);
        }
    }

    private void setEntityCreateInfo(ByaiAimodel entity, Long currentUserId) {
        entity.setCreateBy(currentUserId);
        entity.setCreateTime(new Date());
    }

    public List<ByaiAimodel> listModel(ModelRequest request) {
        request.setStatus(Constants.STATUS_ENABLED);
        return byaiAimodelDomainService.listModel(request);
    }

    public List<ByaiAimodel> listModelInner(ModelRequest request) {
        request.setStatus(Constants.STATUS_ENABLED);
        return byaiAimodelDomainService.listModelInner(request);
    }

    public String getDefaultModelId() {
        ModelRequest request = new ModelRequest();
        request.setStatus(Constants.STATUS_ENABLED);
        request.setTagId(1L);
        List<ByaiAimodel> byaiAimodels = listModel(request);
        if (CollectionUtils.isEmpty(byaiAimodels)) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.chat_model.not.configured");
        }
        for(ByaiAimodel byaiAimodel : byaiAimodels) {
            if(byaiAimodel.getIsDefault() == 1) {
                return byaiAimodel.getModelId().toString();
            }
        }
        return byaiAimodels.getFirst().getModelId().toString();
    }





}
