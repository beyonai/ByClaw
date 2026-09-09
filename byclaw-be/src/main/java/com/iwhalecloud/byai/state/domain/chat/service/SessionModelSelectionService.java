package com.iwhalecloud.byai.state.domain.chat.service;

import java.time.Duration;
import java.util.Optional;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelOwnerType;
import com.iwhalecloud.byai.manager.domain.aimodel.enums.ModelStatusEnum;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.ModelInfoDto;
import com.iwhalecloud.byai.state.domain.chat.dto.PrologueDto;
import com.iwhalecloud.byai.state.domain.chat.model.SessionModelSelection;

/**
 * 个人数字员工会话级模型选择：校验用户选择、维护 Redis 会话覆盖键、解析本轮实际使用的模型。
 *
 * <p>覆盖键 {@code byai:chat:session_model:{sessionId}} 由本服务写入，BY_SUPER（byclaw-super）与
 * BYCLAW_EXE（baiying-enhance / byai-channel）运行时读取，保证「仅当前会话生效」。
 */
@Service
public class SessionModelSelectionService {

    private static final Logger LOGGER = LoggerFactory.getLogger(SessionModelSelectionService.class);

    /** 会话级模型覆盖键前缀，完整键为前缀 + sessionId。 */
    public static final String SESSION_MODEL_KEY_PREFIX = "byai:chat:session_model:";

    /** 覆盖键存活时间；会话长期不用后自动失效，避免 Redis 无限增长。 */
    static final Duration SESSION_MODEL_TTL = Duration.ofDays(7);

    private static final String LLM_MODEL_TYPE = "LLM";

    /** 渠道机器人等入口固定传 -1，表示「不使用会话覆盖」。 */
    private static final String DEFAULT_MODEL_SIGNAL = "-1";

    private final ByaiAimodelMapper byaiAimodelMapper;

    private final AiModelService aiModelService;

    private final SsResExtDigEmployeeService ssResExtDigEmployeeService;

    private final StringRedisTemplate stringRedisTemplate;

    public SessionModelSelectionService(ByaiAimodelMapper byaiAimodelMapper, AiModelService aiModelService,
        SsResExtDigEmployeeService ssResExtDigEmployeeService, StringRedisTemplate stringRedisTemplate) {
        this.byaiAimodelMapper = byaiAimodelMapper;
        this.aiModelService = aiModelService;
        this.ssResExtDigEmployeeService = ssResExtDigEmployeeService;
        this.stringRedisTemplate = stringRedisTemplate;
    }

    /**
     * 校验用户选择并解析模型；选择缺失、非法或不归属当前用户时返回空。
     *
     * @param relModelId 前端会话入参，模型主键字符串
     * @return 校验通过的模型，或空
     */
    public Optional<SessionModelSelection> resolve(String relModelId) {
        Long modelId = parseModelId(relModelId);
        if (modelId == null) {
            return Optional.empty();
        }
        ByaiAimodel entity = byaiAimodelMapper.selectById(modelId);
        if (entity == null) {
            LOGGER.warn("会话模型选择被忽略：模型不存在, modelId={}", modelId);
            return Optional.empty();
        }
        if (!isEnabled(entity.getStatus())) {
            LOGGER.warn("会话模型选择被忽略：模型未启用, modelId={}, status={}", modelId, entity.getStatus());
            return Optional.empty();
        }
        if (StringUtils.isNotBlank(entity.getModelType()) && !LLM_MODEL_TYPE.equalsIgnoreCase(entity.getModelType())) {
            LOGGER.warn("会话模型选择被忽略：非 LLM 模型, modelId={}, modelType={}", modelId, entity.getModelType());
            return Optional.empty();
        }
        if (!isVisibleToCurrentUser(entity)) {
            LOGGER.warn("会话模型选择被忽略：个人模型不归属当前用户, modelId={}", modelId);
            return Optional.empty();
        }
        ModelDto modelDto = aiModelService.getModel(String.valueOf(modelId));
        if (modelDto == null) {
            LOGGER.warn("会话模型选择被忽略：Redis 模型配置缺失, modelId={}", modelId);
            return Optional.empty();
        }
        return Optional.of(toSelection(String.valueOf(modelId), modelDto));
    }

    /**
     * 解析本轮实际使用的模型，并挂到 DTO 的瞬态字段供额度判断与 metadata 复用；幂等。
     *
     * <p>优先级：有效选择 → 显式 -1/非法选择回退 → 会话已有覆盖 → 数字员工配置模型 → 系统默认模型。
     *
     * @param dto 会话入参
     * @return 本轮实际使用的模型，无法解析时为空
     */
    public Optional<SessionModelSelection> resolveSelection(AssistantChatDto dto) {
        if (dto == null) {
            return Optional.empty();
        }
        if (dto.isSessionModelResolved()) {
            return Optional.ofNullable(dto.getSessionModelSelection());
        }
        Optional<SessionModelSelection> selected = resolve(dto.getRelModelId());
        SessionModelSelection effective;
        if (selected.isPresent()) {
            effective = selected.get();
        }
        else if (isDefaultModelSignal(dto.getRelModelId()) || parseModelId(dto.getRelModelId()) != null) {
            // 显式「默认模型」或非法选择：回退到该数字员工配置模型，且由 applySessionOverride 删除旧覆盖。
            effective = resolveConfiguredModel(dto).orElse(null);
        }
        else {
            SessionModelSelection sessionOverride = findSessionOverride(dto.getSessionId()).orElse(null);
            effective = sessionOverride != null ? sessionOverride : resolveConfiguredModel(dto).orElse(null);
        }
        dto.setSessionModelSelection(effective);
        dto.setSessionModelResolved(true);
        return Optional.ofNullable(effective);
    }

    /**
     * 会话标识确定后维护 Redis 覆盖键：有效选择写入；显式默认或非法选择删除；无信号保持不动。
     *
     * @param dto 会话入参（需已确定 sessionId）
     */
    public void applySessionOverride(AssistantChatDto dto) {
        if (dto == null || dto.getSessionId() == null) {
            return;
        }
        Optional<SessionModelSelection> selected = resolve(dto.getRelModelId());
        if (selected.isPresent()) {
            saveSessionOverride(dto.getSessionId(), selected.get());
            return;
        }
        if (isDefaultModelSignal(dto.getRelModelId()) || parseModelId(dto.getRelModelId()) != null) {
            deleteSessionOverride(dto.getSessionId());
        }
    }

    /**
     * 写入会话级模型覆盖。
     *
     * @param sessionId 会话标识
     * @param selection 已校验的模型
     */
    public void saveSessionOverride(Long sessionId, SessionModelSelection selection) {
        if (sessionId == null || selection == null || StringUtils.isBlank(selection.getModelId())) {
            return;
        }
        try {
            stringRedisTemplate.opsForValue().set(sessionModelKey(sessionId), JSON.toJSONString(selection),
                SESSION_MODEL_TTL);
        }
        catch (RuntimeException e) {
            LOGGER.warn("写入会话模型覆盖失败, sessionId={}, modelId={}: {}", sessionId, selection.getModelId(),
                e.getMessage());
        }
    }

    /**
     * 删除会话级模型覆盖。
     *
     * @param sessionId 会话标识
     */
    public void deleteSessionOverride(Long sessionId) {
        if (sessionId == null) {
            return;
        }
        try {
            stringRedisTemplate.delete(sessionModelKey(sessionId));
        }
        catch (RuntimeException e) {
            LOGGER.warn("删除会话模型覆盖失败, sessionId={}: {}", sessionId, e.getMessage());
        }
    }

    /**
     * 读取会话级模型覆盖。
     *
     * @param sessionId 会话标识
     * @return 覆盖模型，或空
     */
    public Optional<SessionModelSelection> findSessionOverride(Long sessionId) {
        if (sessionId == null) {
            return Optional.empty();
        }
        try {
            String json = stringRedisTemplate.opsForValue().get(sessionModelKey(sessionId));
            if (StringUtils.isBlank(json)) {
                return Optional.empty();
            }
            SessionModelSelection selection = JSON.parseObject(json, SessionModelSelection.class);
            return selection == null || StringUtils.isBlank(selection.getModelId()) ? Optional.empty()
                : Optional.of(selection);
        }
        catch (RuntimeException e) {
            LOGGER.warn("读取会话模型覆盖失败, sessionId={}: {}", sessionId, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * 解析数字员工配置模型：优先 prologue.modelInfo.modelId，其次系统默认聊天模型。
     *
     * @param dto 会话入参
     * @return 配置模型，或空
     */
    Optional<SessionModelSelection> resolveConfiguredModel(AssistantChatDto dto) {
        Long agentId = dto == null ? null : dto.getAgentId();
        if (agentId != null) {
            SsResExtDigEmployee ext = ssResExtDigEmployeeService.findById(agentId);
            if (ext != null && StringUtils.isNotBlank(ext.getPrologue())) {
                Long modelId = extractModelId(ext.getPrologue());
                if (modelId != null) {
                    ModelDto modelDto = aiModelService.getModel(String.valueOf(modelId));
                    if (modelDto != null) {
                        return Optional.of(toSelection(String.valueOf(modelId), modelDto));
                    }
                    LOGGER.warn("数字员工配置模型在 Redis 中不存在, agentId={}, modelId={}", agentId, modelId);
                }
            }
        }
        ModelDto defaultModel = aiModelService.getDefaultChatModel();
        return defaultModel == null ? Optional.empty()
            : Optional.of(toSelection(defaultModel.getInstanceId(), defaultModel));
    }

    private Long extractModelId(String prologueJson) {
        try {
            PrologueDto prologue = JSON.parseObject(prologueJson, PrologueDto.class);
            if (prologue == null) {
                return null;
            }
            ModelInfoDto modelInfo = prologue.getModelInfo();
            if (modelInfo != null && modelInfo.getModelId() != null) {
                return modelInfo.getModelId();
            }
            return prologue.getModelId();
        }
        catch (RuntimeException e) {
            LOGGER.warn("解析数字员工 prologue 失败: {}", e.getMessage());
            return null;
        }
    }

    private SessionModelSelection toSelection(String modelId, ModelDto modelDto) {
        String code = StringUtils.defaultIfBlank(modelDto.getModelCode(), modelDto.getModelName());
        String name = StringUtils.defaultIfBlank(modelDto.getModelName(), code);
        return new SessionModelSelection(modelId, code, name, modelDto.getProviderName());
    }

    private boolean isVisibleToCurrentUser(ByaiAimodel entity) {
        if (!ModelOwnerType.PERSONAL.equalsIgnoreCase(entity.getOwnerType())) {
            return ModelOwnerType.PUBLIC.equalsIgnoreCase(entity.getOwnerType());
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        return userId != null && userId.equals(entity.getCreateBy());
    }

    private boolean isEnabled(String status) {
        return ModelStatusEnum.isEnabledDb(status) || "1".equals(status) || "ENABLED".equalsIgnoreCase(status);
    }

    private boolean isDefaultModelSignal(String relModelId) {
        return DEFAULT_MODEL_SIGNAL.equals(StringUtils.trimToEmpty(relModelId));
    }

    /**
     * 解析模型主键；空、-1、非数字（桌面本地模型 id）返回 null。
     *
     * @param relModelId 前端入参
     * @return 正整数模型主键，或 null
     */
    public Long parseModelId(String relModelId) {
        String value = StringUtils.trimToEmpty(relModelId);
        if (value.isEmpty() || DEFAULT_MODEL_SIGNAL.equals(value)) {
            return null;
        }
        try {
            long modelId = Long.parseLong(value);
            return modelId > 0 ? modelId : null;
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    private String sessionModelKey(Long sessionId) {
        return SESSION_MODEL_KEY_PREFIX + sessionId;
    }
}
