package com.iwhalecloud.byai.state.domain.chat.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.state.application.service.limit.TokenQuotaService;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.SessionModelSelection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/** One frozen execution model per authenticated request; never write Auto into the manual override axis. */
@Slf4j
@Service
public class AutoModelRoutingService {
    private static final Duration TTL = Duration.ofDays(7);
    private final AutoModelRoutingProperties config;
    private final JevDecisionClient jev;
    private final AiModelService models;
    private final TokenQuotaService quotas;
    private final StringRedisTemplate redis;
    private final ParamService params;
    @org.springframework.beans.factory.annotation.Autowired
    private RunningOutputStreamRegistry runningStreams;

    public AutoModelRoutingService(AutoModelRoutingProperties config, JevDecisionClient jev, AiModelService models,
        TokenQuotaService quotas, StringRedisTemplate redis, @org.springframework.context.annotation.Lazy ParamService params) {
        this.config = config;
        this.jev = jev;
        this.models = models;
        this.quotas = quotas;
        this.redis = redis;
        this.params = params;
    }

    public Map<String, Object> capabilities() {
        boolean available = TenantRequestContextHolder.get() == null && config.isEnabled() && jev.configured() && config.getTimeoutMs() > 0 &&
            models.getModelList().stream().anyMatch(model -> annotation(model) != null);
        return Map.of("protocolVersion", 1, "autoAvailable", available,
            "modes", available ? List.of("default", "manual", "auto") : List.of("default", "manual"));
    }

    public static boolean isAuto(AssistantChatDto dto) {
        return dto != null && "auto".equals(dto.getModelSelectionMode());
    }

    public static void validate(AssistantChatDto dto) {
        if (dto == null || StringUtils.isBlank(dto.getModelSelectionMode())) return;
        String mode = dto.getModelSelectionMode();
        boolean valid = switch (mode) {
            case "auto" -> StringUtils.isBlank(dto.getRelModelId()) &&
                (StringUtils.isBlank(dto.getRelThinkingLevel()) || "-1".equals(dto.getRelThinkingLevel()));
            case "default" -> "-1".equals(dto.getRelModelId());
            case "manual" -> dto.getRelModelId() != null && dto.getRelModelId().matches("[1-9]\\d*");
            default -> false;
        };
        if (!valid) throw failure("INVALID_MODEL_SELECTION", "auto.model.invalid");
    }

    public SessionModelSelection route(AssistantChatDto dto, Function<String, java.util.Optional<SessionModelSelection>> authorize) {
        if (CurrentUserHolder.getCurrentUserId() == null) throw failure("INVALID_MODEL_SELECTION", "auto.model.invalid");

        if (TenantRequestContextHolder.get() != null || dto.getOrchestrator() != null ||
            !params.supportsAutoRouting(dto.getAgentId()) ||
            (dto.getExtParams() != null && dto.getExtParams().containsKey("multiAgent")) || "GROUP".equalsIgnoreCase(dto.getSessionType())) {
            throw failure("AUTO_UNSUPPORTED_RUNTIME", "auto.model.unsupported");
        }
        String scope = "byai:chat:run_model:" + CurrentUserHolder.getCurrentUserId() + ":" + dto.getSessionId() + ":" + dto.getAgentId();
        boolean resume = "RESUME".equalsIgnoreCase(dto.getActionType()) || StringUtils.isNotBlank(dto.getTraceId());
        if (runningStreams != null) {
            var running = runningStreams.getRunning(dto.getSessionId());
            if (running != null && Boolean.TRUE.equals(running.getRunning())) {
                if (StringUtils.isBlank(dto.getTraceId()) || !dto.getTraceId().equals(running.getTraceId())) {
                    throw failure("AUTO_ROUTING_BUSY", "auto.model.busy");
                }
                resume = true;
            }
        }
        String requestId = StringUtils.defaultIfBlank(dto.getClientRequestId(), dto.getTraceId());
        if (StringUtils.isBlank(requestId)) throw failure("INVALID_MODEL_SELECTION", "auto.model.invalid");
        String cacheKey = scope + ":" + digest(requestId);
        String resumeKey = StringUtils.isNotBlank(dto.getTraceId()) ? scope + ":trace:" + digest(dto.getTraceId()) : scope + ":latest";
        String saved = redis.opsForValue().get(resume ? resumeKey : cacheKey);
        if (saved != null) {
            if (!resume && redis.opsForValue().get(scope + ":routing") != null) throw failure("AUTO_ROUTING_BUSY", "auto.model.busy");
            SessionModelSelection snapshot = JSON.parseObject(saved, SessionModelSelection.class);
            if (!resume && !requestHash(dto).equals(snapshot.getRequestHash())) {
                throw failure("INVALID_MODEL_SELECTION", "auto.model.invalid");
            }
            authorize.apply(snapshot.getModelId()).orElseThrow(() -> failure("AUTO_NO_COMPATIBLE_MODEL", "auto.model.noCandidate"));
            if (!configVersion(snapshot.getModelId()).equals(snapshot.getModelConfigVersion())) {
                throw failure("AUTO_CONFIG_CHANGED", "auto.model.configChanged");
            }
            checkQuota(snapshot);
            redis.expire(resume ? resumeKey : cacheKey, TTL);
            return snapshot;
        }
        if (resume) throw failure("AUTO_SNAPSHOT_MISSING", "auto.model.snapshotMissing");
        if (!config.isEnabled() || !jev.configured()) throw failure("AUTO_DISABLED", "auto.model.disabled");
        String lockKey = scope + ":routing";
        if (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(lockKey, requestId, Duration.ofSeconds(30)))) {
            throw failure("AUTO_ROUTING_BUSY", "auto.model.busy");
        }
        try {
            return decide(dto, authorize, scope, cacheKey, requestId);
        } catch (RuntimeException error) {
            releaseRouting(dto);
            throw error;
        }
    }

    public void releaseRouting(AssistantChatDto dto) {
        String requestId = StringUtils.defaultIfBlank(dto.getClientRequestId(), dto.getTraceId());
        String lockKey = "byai:chat:run_model:" + CurrentUserHolder.getCurrentUserId() + ":" + dto.getSessionId() + ":" + dto.getAgentId() + ":routing";
        if (requestId == null || dto.getSessionId() == null) return;
        // Compare/delete prevents an expired owner from removing a newer routing lock.
        try {
            redis.execute(new org.springframework.data.redis.core.script.DefaultRedisScript<>(
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", Long.class),
                List.of(lockKey), requestId);
        } catch (RuntimeException error) {
            log.warn("model.route.lock-release-failed errorType={}", error.getClass().getSimpleName());
        }
    }

    public void restoreResumeMode(AssistantChatDto dto) {
        if (!"RESUME".equalsIgnoreCase(dto.getActionType()) && StringUtils.isBlank(dto.getTraceId())) return;
        String key = "byai:chat:run_model:" + CurrentUserHolder.getCurrentUserId() + ":" + dto.getSessionId() + ":" + dto.getAgentId() + (StringUtils.isNotBlank(dto.getTraceId()) ? ":trace:" + digest(dto.getTraceId()) : ":latest");
        if (redis.opsForValue().get(key) != null) {
            dto.setModelSelectionMode("auto");
            dto.setRelModelId(null);
            dto.setRelThinkingLevel("-1");
        }
    }

    public void bindTrace(AssistantChatDto dto, String traceId) {
        if (!isAuto(dto) || dto.getSessionModelSelection() == null || StringUtils.isBlank(traceId)) return;
        redis.opsForValue().set("byai:chat:run_model:" + CurrentUserHolder.getCurrentUserId() + ":" + dto.getSessionId() + ":" + dto.getAgentId() + ":trace:" + digest(traceId),
            JSON.toJSONString(dto.getSessionModelSelection()), TTL);
    }

    public void clearActiveSnapshot(AssistantChatDto dto) {
        redis.delete("byai:chat:run_model:" + CurrentUserHolder.getCurrentUserId() + ":" + dto.getSessionId() + ":" + dto.getAgentId() + ":latest");
    }

    private SessionModelSelection decide(AssistantChatDto dto, Function<String, java.util.Optional<SessionModelSelection>> authorize,
        String scope, String cacheKey, String requestId) {
        List<Map<String, String>> history = params.getChatHistories(dto.getSessionId(), 3);
        String prompt = StringUtils.defaultString(dto.getChatContent());
        boolean vision = dto.getFiles() != null && dto.getFiles().stream().anyMatch(file ->
            "image".equalsIgnoreCase(file.getFileType()) || StringUtils.defaultString(file.getFileName()).matches("(?i).*\\.(png|jpe?g|webp|gif)$"));
        vision |= history.stream().anyMatch(item -> java.util.regex.Pattern.compile("(?i)!\\[[^\\]]*\\.(png|jpe?g|webp|gif)\\]\\(")
            .matcher(StringUtils.defaultString(item.get("content"))).find());
        int contextBudget = Math.max(8192, (prompt.length() + history.stream().mapToInt(h -> h.get("content").length()).sum()) + 8192);
        List<Usable> candidates = new ArrayList<>();
        boolean quotaBlocked = false;
        for (ModelDto indexed : models.getModelList()) {
            if (indexed.getInstanceId() == null || !indexed.getInstanceId().matches("[1-9]\\d*")) continue;
            Object raw = redis.opsForHash().get(com.iwhalecloud.byai.common.constants.staticdata.RedisConfig.AI_MODEL_KEY, indexed.getInstanceId());
            if (!(raw instanceof String content)) continue;
            ModelDto model = JSON.parseObject(content, ModelDto.class);
            AutoModelRoutingProperties.Candidate annotation = annotation(model);
            if (annotation == null || !annotation.getCapabilities().contains("tools") ||
                (vision && !supportsVision(model))) continue;
            int window;
            try { window = Integer.parseInt(model.getMaxContentToken()); } catch (RuntimeException e) { continue; }
            if (window < contextBudget) continue;
            SessionModelSelection selection = authorize.apply(model.getInstanceId()).orElse(null);
            if (selection == null) continue;
            try { com.iwhalecloud.byai.manager.domain.aimodel.service.ModelConfigurationValidator.validate(model); }
            catch (RuntimeException e) { continue; }
            if (subjectToQuota(selection)) { quotaBlocked = true; continue; }
            selection.setModelConfigVersion(digest(content));
            candidates.add(new Usable(selection, annotation, model));
        }
        candidates.sort(Comparator.comparingInt((Usable c) -> c.annotation.getPriority()).thenComparing(c -> c.selection.getModelId()));
        if (candidates.isEmpty()) throw failure(quotaBlocked ? "AUTO_QUOTA_EXCEEDED" : "AUTO_NO_COMPATIBLE_MODEL",
            quotaBlocked ? "auto.model.quota" : "auto.model.noCandidate");
        String reason = "single_candidate";
        boolean fallback = false;
        double confidence = 1;
        Usable chosen = candidates.get(0);
        if (candidates.size() > 1) {
            try {
                Map<String, Object> state = Map.of("currentMessage", abbreviate(prompt, 16000),
                    "recentMessages", history.stream().map(h -> Map.of("role", h.get("role"), "content", abbreviate(h.get("content").replaceAll("!\\[[^\\]]*\\]\\([^)]*\\)", "[attachment]"), 2000))).toList(),
                    "agent", Map.of("id", String.valueOf(dto.getAgentId()), "requiresTools", true),
                    "attachments", Map.of("hasImages", vision), "estimatedContextBudget", contextBudget,
                    "candidateModels", candidates.stream().map(this::decisionMetadata).toList());
                Decision decision = parseDecision(jev.evaluate(state), config,
                    candidates.stream().map(c -> c.selection.getModelId()).collect(java.util.stream.Collectors.toSet()));
                confidence = decision.confidence;
                fallback = decision.uncertain;
                reason = fallback ? "uncertain_decision" : "model_choice";
                chosen = fallback ? fallback(candidates) : candidates.stream()
                    .filter(c -> c.selection.getModelId().equals(decision.modelId)).findFirst().orElseThrow();
            } catch (Exception e) {
                fallback = true;
                confidence = 0;
                reason = "decision_failed";
                chosen = fallback(candidates);
                log.warn("model.route.fallback requestId={} reason=decision_failed errorType={}", requestId, e.getClass().getSimpleName());
            }
        }
        SessionModelSelection result = chosen.selection;
        if (!configVersion(result.getModelId()).equals(result.getModelConfigVersion())) {
            throw failure("AUTO_CONFIG_CHANGED", "auto.model.configChanged");
        }
        result.setRequestHash(requestHash(dto));
        result.setRunId(digest(scope + ":" + requestId));
        result.setModelRouting(new LinkedHashMap<>(Map.of("schemaVersion", 1, "mode", "auto", "policyVersion", config.getPolicyVersion(),
            "decisionModel", "typesafe-ai/jev", "reason", reason,
            "fallback", fallback, "confidence", confidence, "executionStatus", "selected")));
        checkQuota(result);
        String json = JSON.toJSONString(result);
        redis.opsForValue().set(cacheKey, json, TTL);
        redis.opsForValue().set(scope + ":latest", json, TTL);
        log.info("model.route.frozen requestId={} modelId={} reason={}", requestId, result.getModelId(), reason);
        return result;
    }

    private AutoModelRoutingProperties.Candidate annotation(ModelDto model) {
        var override = config.getCandidates().stream().filter(c -> String.valueOf(c.getModelId()).equals(model.getInstanceId())).findFirst();
        if (override.isPresent()) return validAnnotation(override.get()) ? override.get() : null;
        Object raw = model.getInstanceParam() == null ? null : model.getInstanceParam().get("autoRouting");
        if (!(raw instanceof Map<?, ?> map) || !Boolean.TRUE.equals(map.get("enabled"))) return null;
        var candidate = JSON.parseObject(JSON.toJSONString(raw), AutoModelRoutingProperties.Candidate.class);
        return validAnnotation(candidate) ? candidate : null;
    }

    private boolean validAnnotation(AutoModelRoutingProperties.Candidate candidate) {
        return candidate.getCapabilities() != null && candidate.getCapabilities().contains("tools");
    }

    private Map<String, Object> decisionMetadata(Usable candidate) {
        ModelDto model = candidate.model;
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("modelId", candidate.selection.getModelId());
        metadata.put("modelCode", StringUtils.defaultString(model.getModelCode()));
        metadata.put("displayName", StringUtils.defaultString(model.getModelName(), model.getInstanceName()));
        Object provider = model.getInstanceParam() == null ? null : model.getInstanceParam().get("providerName");
        metadata.put("providerName", StringUtils.defaultIfBlank(model.getProviderName(), provider instanceof String name ? name : ""));
        metadata.put("contextTokens", Integer.parseInt(model.getMaxContentToken()));
        metadata.put("supportsImages", supportsVision(model));
        metadata.put("supportsTools", true);
        metadata.put("description", abbreviate(StringUtils.defaultString(candidate.annotation.getDescription()), 1000));
        // Missing prices and measured performance remain unknown; never infer them from a provider brand.
        return metadata;
    }

    private boolean supportsVision(ModelDto model) {
        Object abilities = model.getInstanceParam() == null ? null : model.getInstanceParam().get("abilities");
        if (abilities instanceof List<?> list) return list.stream().anyMatch(value -> "7".equals(String.valueOf(value)));
        return abilities != null && java.util.Arrays.stream(String.valueOf(abilities).replace("[", "").replace("]", "").replace("\"", "").split(","))
            .anyMatch(value -> "7".equals(value.trim()));
    }

    private Usable fallback(List<Usable> candidates) {
        for (String id : config.getFallbackModelIds()) {
            var match = candidates.stream().filter(c -> id.equals(c.selection.getModelId())).findFirst();
            if (match.isPresent()) return match.get();
        }
        ModelDto defaultModel = models.getDefaultChatModel();
        return candidates.stream().filter(c -> defaultModel != null && defaultModel.getInstanceId().equals(c.selection.getModelId())).findFirst()
            .orElse(candidates.get(0));
    }

    public static Decision parseDecision(JSONObject response, AutoModelRoutingProperties config, Set<String> modelIds) {
        JSONObject answers = response == null ? null : response.getJSONObject("answers");
        JSONObject choice = answers == null ? null : answers.getJSONObject("selectedModel");
        if (choice == null || modelIds.isEmpty()) throw new IllegalArgumentException("Missing model decision");
        if (!"choice".equals(choice.getString("type"))) throw new IllegalArgumentException("Invalid decision type");
        String selected = choice.getString("choice");
        Set<String> keys = modelIds.stream().map(id -> "model_" + id).collect(java.util.stream.Collectors.toSet());
        if (!keys.contains(selected)) throw new IllegalArgumentException("Unknown model choice");
        List<Double> probabilities = checkedProbabilities(choice.getJSONObject("probabilities"), keys);
        if (choice.containsKey("confidence") && !(choice.get("confidence") instanceof Number)) throw new IllegalArgumentException("Invalid confidence");
        if (choice.getJSONObject("probabilities").getDoubleValue(selected) < probabilities.get(0)) throw new IllegalArgumentException("Invalid choice rank");
        double confidence = choice.containsKey("confidence") ? choice.getDoubleValue("confidence") : probabilities.get(0);
        if (!Double.isFinite(confidence) || confidence < 0 || confidence > 1) throw new IllegalArgumentException("Invalid confidence");
        double runnerUp = probabilities.size() > 1 ? probabilities.get(1) : 0;
        boolean uncertain = confidence < config.getMinConfidence() || probabilities.get(0) < config.getMinChoiceProbability() ||
            probabilities.get(0) - runnerUp < config.getMinChoiceMargin();
        return new Decision(selected.substring("model_".length()), confidence, uncertain);
    }

    private static List<Double> checkedProbabilities(JSONObject raw, Set<String> keys) {
        if (raw == null || !raw.keySet().equals(keys)) throw new IllegalArgumentException("Invalid probabilities");
        List<Double> values = new ArrayList<>();
        for (String key : keys) {
            if (!(raw.get(key) instanceof Number)) throw new IllegalArgumentException("Invalid probability");
            double value = raw.getDoubleValue(key);
            if (!Double.isFinite(value) || value < 0 || value > 1) throw new IllegalArgumentException("Invalid probability");
            values.add(value);
        }
        if (Math.abs(values.stream().mapToDouble(Double::doubleValue).sum() - 1) > 0.02) throw new IllegalArgumentException("Invalid probability sum");
        values.sort(Comparator.reverseOrder());
        return values;
    }

    private boolean subjectToQuota(SessionModelSelection selection) {
        return quotas.isModelSubjectToQuotaByModelId(Long.valueOf(selection.getModelId())) &&
            quotas.isQuotaExceeded(CurrentUserHolder.getCurrentUserId());
    }

    public void checkQuota(SessionModelSelection selection) {
        if (subjectToQuota(selection)) throw failure("AUTO_QUOTA_EXCEEDED", "auto.model.quota");
    }

    private static String abbreviate(String text, int length) { return StringUtils.abbreviate(text, length); }
    private String configVersion(String id) {
        Object raw = redis.opsForHash().get(com.iwhalecloud.byai.common.constants.staticdata.RedisConfig.AI_MODEL_KEY, id);
        if (!(raw instanceof String content)) throw failure("AUTO_CONFIG_CHANGED", "auto.model.configChanged");
        return digest(content);
    }

    private static String requestHash(AssistantChatDto dto) {
        return digest(JSON.toJSONString(java.util.Arrays.asList(dto.getChatContent(), dto.getFiles(), dto.getResourceList())));
    }
    private static String digest(String text) {
        try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static BdpRuntimeException failure(String code, String key) { return new RoutingException(code, I18nUtil.get(key)); }
    public static class RoutingException extends BdpRuntimeException {
        private final String errorCode;
        public RoutingException(String errorCode, String message) { super(message); this.errorCode = errorCode; }
        public String getErrorCode() { return errorCode; }
    }
    private record Usable(SessionModelSelection selection, AutoModelRoutingProperties.Candidate annotation, ModelDto model) {}
    public record Decision(String modelId, double confidence, boolean uncertain) {}
}
