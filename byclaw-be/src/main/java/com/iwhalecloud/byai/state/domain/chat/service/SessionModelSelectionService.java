package com.iwhalecloud.byai.state.domain.chat.service;

import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

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

    /**
     * 会话级思考强度词表，必须与 byclaw-super 的 THINKING_LEVELS 保持一致
     * （byclaw-super/packages/by-conductor/src/domain/types.ts）：词表外的值会让整轮抛错。
     */
    public static final List<String> THINKING_LEVELS =
        List.of("off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max");

    /** 关闭档位；词表外取值与未启用 reasoning 的模型一律回落到它。 */
    private static final String THINKING_OFF = "off";

    /** 档位来源：用户显式选择，可作为下一轮覆盖候选。 */
    static final String THINKING_SOURCE_SESSION = "session";

    /** 档位来源：模型 reasoningConfig.defaultLevel。 */
    static final String THINKING_SOURCE_MODEL_DEFAULT = "model_default";

    /** 档位来源：模型未启用 reasoning 或档位非法。 */
    static final String THINKING_SOURCE_OFF = "off";

    private static final String REASONING_CONFIG_KEY = "reasoningConfig";

    private static final String CAPABILITY_UNSUPPORTED = "unsupported";

    private static final String CAPABILITY_BINARY = "binary";

    private static final String CAPABILITY_ADAPTIVE = "adaptive";

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
        SessionModelSelection record = readSessionOverrideRecord(dto.getSessionId()).orElse(null);
        // 会话覆盖记录为双轴结构：仅当模型轴非空时才可作为模型回退来源。
        SessionModelSelection modelOverride = record != null && StringUtils.isNotBlank(record.getModelId()) ? record
            : null;
        Optional<SessionModelSelection> selected = resolve(dto.getRelModelId());
        SessionModelSelection effective;
        if (selected.isPresent()) {
            effective = selected.get();
        }
        else if (isDefaultModelSignal(dto.getRelModelId()) || parseModelId(dto.getRelModelId()) != null) {
            // 显式「默认模型」或非法选择：回退到该数字员工配置模型，且由 applySessionOverride 清空模型轴。
            effective = resolveConfiguredModel(dto).orElse(null);
        }
        else {
            effective = modelOverride != null ? modelOverride : resolveConfiguredModel(dto).orElse(null);
        }
        resolveThinkingLevel(dto, effective, record);
        dto.setSessionModelSelection(effective);
        dto.setSessionModelResolved(true);
        return Optional.ofNullable(effective);
    }

    /**
     * 解析本轮实际使用的思考强度档位，并写回有效选择对象。
     *
     * <p>优先级：本轮显式选择 → 会话档位覆盖 → 模型 defaultLevel → off。
     * 显式「跟随默认」(-1) 或非法档位会跳过覆盖，直接回落模型默认档位。
     *
     * @param dto 会话入参
     * @param effective 本轮有效模型（解析结果会写回其 thinkingLevel/thinkingSource）
     * @param record 会话覆盖记录（双轴结构，可为空）
     */
    void resolveThinkingLevel(AssistantChatDto dto, SessionModelSelection effective, SessionModelSelection record) {
        if (effective == null || StringUtils.isBlank(effective.getModelId())) {
            return;
        }
        ReasoningConfig reasoning = reasoningConfigOf(effective.getModelId());
        if (!reasoning.enabled) {
            applyThinking(effective, THINKING_OFF, THINKING_SOURCE_OFF);
            return;
        }
        String signal = dto == null ? null : dto.getRelThinkingLevel();
        Optional<String> explicit = normalizeThinkingLevel(signal);
        if (explicit.isPresent() && isAllowedLevel(reasoning, explicit.get())) {
            applyThinking(effective, explicit.get(), THINKING_SOURCE_SESSION);
            return;
        }
        // 显式信号（含「跟随默认」与非法值）不继承旧覆盖，避免用户意图不明的档位残留。
        if (StringUtils.isBlank(signal) && record != null
            && THINKING_SOURCE_SESSION.equals(record.getThinkingSource())) {
            Optional<String> override = normalizeThinkingLevel(record.getThinkingLevel());
            if (override.isPresent() && isAllowedLevel(reasoning, override.get())) {
                applyThinking(effective, override.get(), THINKING_SOURCE_SESSION);
                return;
            }
        }
        Optional<String> modelDefault = normalizeThinkingLevel(reasoning.defaultLevel);
        if (modelDefault.isPresent()) {
            applyThinking(effective, modelDefault.get(), THINKING_SOURCE_MODEL_DEFAULT);
            return;
        }
        applyThinking(effective, THINKING_OFF, THINKING_SOURCE_OFF);
    }

    private void applyThinking(SessionModelSelection selection, String level, String source) {
        selection.setThinkingLevel(level);
        selection.setThinkingSource(source);
    }

    /**
     * 判断用户档位是否被该模型的能力声明接受；后端是唯一强制方，前端渲染规则与此一致。
     *
     * @param reasoning 模型 reasoning 配置
     * @param level 词表内的档位
     * @return 是否接受
     */
    boolean isAllowedLevel(ReasoningConfig reasoning, String level) {
        if (THINKING_OFF.equals(level)) {
            return true;
        }
        if (!reasoning.enabled) {
            return false;
        }
        // 所有能力类型共用同一档位规则：有 supportedEfforts 时按白名单，否则使用完整词表。
        return reasoning.supportedEfforts.isEmpty() || reasoning.supportedEfforts.contains(level);
    }

    /**
     * 解析模型 reasoning 配置；缺失或非法按「未启用」处理（保守关闭思考）。
     *
     * @param modelId 模型主键
     * @return reasoning 配置，永不为空
     */
    ReasoningConfig reasoningConfigOf(String modelId) {
        ModelDto modelDto = StringUtils.isBlank(modelId) ? null : aiModelService.getModel(modelId);
        Map<String, Object> instanceParam = modelDto == null ? null : modelDto.getInstanceParam();
        Object raw = instanceParam == null ? null : instanceParam.get(REASONING_CONFIG_KEY);
        if (!(raw instanceof Map)) {
            return ReasoningConfig.unsupported();
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> config = (Map<String, Object>) raw;
        if (!Boolean.TRUE.equals(config.get("enabled"))) {
            return ReasoningConfig.unsupported();
        }
        String capability = normalizeString(config.get("capability"), CAPABILITY_UNSUPPORTED);
        if (CAPABILITY_UNSUPPORTED.equals(capability)) {
            return ReasoningConfig.unsupported();
        }
        Set<String> supported = new LinkedHashSet<>();
        if (config.get("supportedEfforts") instanceof List) {
            for (Object item : (List<?>) config.get("supportedEfforts")) {
                // off 不是「可启用档位」，写进 supportedEfforts 不构成白名单，过滤后与前端规则一致。
                normalizeThinkingLevel(item == null ? null : String.valueOf(item))
                    .filter(level -> !THINKING_OFF.equals(level)).ifPresent(supported::add);
            }
        }
        String defaultLevel = normalizeThinkingLevel(normalizeString(config.get("defaultLevel"), null))
            .orElse(null);
        String firstSupported = supported.stream().filter(level -> !THINKING_OFF.equals(level)).findFirst()
            .orElse(null);
        ReasoningConfig reasoning = new ReasoningConfig();
        reasoning.enabled = true;
        reasoning.capability = capability;
        reasoning.defaultLevel = defaultLevel;
        reasoning.supportedEfforts = supported;
        reasoning.firstSupported = firstSupported;
        return reasoning;
    }

    /**
     * 归一化档位：仅接受词表内的值。
     *
     * @param raw 原始档位
     * @return 词表内的档位，或空
     */
    Optional<String> normalizeThinkingLevel(String raw) {
        String value = StringUtils.trimToEmpty(raw).toLowerCase();
        return THINKING_LEVELS.contains(value) ? Optional.of(value) : Optional.empty();
    }

    private static String normalizeString(Object raw, String fallback) {
        String value = raw == null ? "" : String.valueOf(raw).trim().toLowerCase();
        return value.isEmpty() ? fallback : value;
    }

    /** 模型 reasoning 配置的运行期视图。 */
    static final class ReasoningConfig {

        boolean enabled;

        String capability = CAPABILITY_UNSUPPORTED;

        String defaultLevel;

        Set<String> supportedEfforts = Set.of();

        String firstSupported;

        static ReasoningConfig unsupported() {
            return new ReasoningConfig();
        }

        /** binary/adaptive 的「开启」档位：优先 defaultLevel，其次首个受支持档位；off 不算「开启」。 */
        String onLevel() {
            return defaultLevel != null && !THINKING_OFF.equals(defaultLevel) ? defaultLevel : firstSupported;
        }
    }

    /**
     * 会话标识确定后维护 Redis 覆盖记录（双轴，一次写入）：
     * 模型轴由显式选择决定（有效选择写入、显式默认/非法数值清空、无信号保留）；
     * 档位轴写入本轮最终档位。两轴都为空时删除该键。
     *
     * @param dto 会话入参（需已确定 sessionId，且已完成 resolveSelection）
     */
    public void applySessionOverride(AssistantChatDto dto) {
        if (dto == null || dto.getSessionId() == null) {
            return;
        }
        SessionModelSelection record = readSessionOverrideRecord(dto.getSessionId()).orElse(null);
        SessionModelSelection modelAxis = resolveModelAxis(dto, record);
        SessionModelSelection effective = dto.getSessionModelSelection();
        String level = effective == null ? null : effective.getThinkingLevel();
        String source = effective == null ? null : effective.getThinkingSource();
        if (StringUtils.isBlank(level) && record != null && StringUtils.isNotBlank(record.getThinkingLevel())) {
            // 本轮连有效模型都没解析出来：保留用户已选的档位轴，不因模型轴的变化而连带清空（两轴独立）。
            level = record.getThinkingLevel();
            source = record.getThinkingSource();
        }
        if (modelAxis == null && StringUtils.isBlank(level)) {
            deleteSessionOverride(dto.getSessionId());
            return;
        }
        SessionModelSelection next = modelAxis != null ? modelAxis : new SessionModelSelection();
        next.setThinkingLevel(level);
        next.setThinkingSource(source);
        saveSessionOverride(dto.getSessionId(), next);
    }

    /**
     * 计算覆盖记录的模型轴。
     *
     * @param dto 会话入参
     * @param record 会话已有覆盖记录
     * @return 要写入的模型轴，空表示清空模型轴
     */
    private SessionModelSelection resolveModelAxis(AssistantChatDto dto, SessionModelSelection record) {
        Optional<SessionModelSelection> selected = resolve(dto.getRelModelId());
        if (selected.isPresent()) {
            return selected.get();
        }
        if (isDefaultModelSignal(dto.getRelModelId()) || parseModelId(dto.getRelModelId()) != null) {
            return null;
        }
        if (record == null || StringUtils.isBlank(record.getModelId())) {
            return null;
        }
        // 无模型信号：保留已有模型轴（不做数字员工配置模型固化）。
        SessionModelSelection axis = new SessionModelSelection();
        axis.setModelId(record.getModelId());
        axis.setModelCode(record.getModelCode());
        axis.setModelName(record.getModelName());
        axis.setProviderName(record.getProviderName());
        return axis;
    }

    /**
     * 写入会话级模型/档位覆盖。
     *
     * @param sessionId 会话标识
     * @param selection 已校验的模型轴或档位轴（至少一轴非空）
     */
    public void saveSessionOverride(Long sessionId, SessionModelSelection selection) {
        if (sessionId == null || selection == null
            || (StringUtils.isBlank(selection.getModelId()) && StringUtils.isBlank(selection.getThinkingLevel()))) {
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
     * 读取会话级模型覆盖（模型轴）；仅选择档位、未选择模型的记录返回空。
     *
     * @param sessionId 会话标识
     * @return 覆盖模型，或空
     */
    public Optional<SessionModelSelection> findSessionOverride(Long sessionId) {
        return readSessionOverrideRecord(sessionId).filter(selection -> StringUtils.isNotBlank(selection.getModelId()));
    }

    /**
     * 读取 Redis 会话覆盖记录原文（双轴结构，模型轴可能为空）。
     *
     * @param sessionId 会话标识
     * @return 记录，或空
     */
    Optional<SessionModelSelection> readSessionOverrideRecord(Long sessionId) {
        if (sessionId == null) {
            return Optional.empty();
        }
        try {
            String json = stringRedisTemplate.opsForValue().get(sessionModelKey(sessionId));
            if (StringUtils.isBlank(json)) {
                return Optional.empty();
            }
            SessionModelSelection selection = JSON.parseObject(json, SessionModelSelection.class);
            return selection == null ? Optional.empty() : Optional.of(selection);
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
     * @return 非零模型主键（保留 -1 为默认信号），或 null
     */
    public Long parseModelId(String relModelId) {
        String value = StringUtils.trimToEmpty(relModelId);
        if (value.isEmpty() || DEFAULT_MODEL_SIGNAL.equals(value)) {
            return null;
        }
        try {
            long modelId = Long.parseLong(value);
            return modelId != 0 && modelId != -1 ? modelId : null;
        }
        catch (NumberFormatException e) {
            return null;
        }
    }

    private String sessionModelKey(Long sessionId) {
        return SESSION_MODEL_KEY_PREFIX + sessionId;
    }
}
