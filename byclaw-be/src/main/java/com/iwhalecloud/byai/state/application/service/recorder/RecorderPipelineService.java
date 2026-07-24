package com.iwhalecloud.byai.state.application.service.recorder;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class RecorderPipelineService {

    private static final Logger log = LoggerFactory.getLogger(RecorderPipelineService.class);
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final String ACTIVE_VERIFY_TOKEN = "_activeVerifyToken";
    static final int MAX_SOURCE_BYTES = 1024 * 1024;
    private static final String SOURCE_VALIDATION_MESSAGE =
        "adapter source must be nonblank and at most 1048576 UTF-8 bytes";

    private final RecorderDraftStore draftStore;
    private final RecorderVerifyService verifyService;
    private final RecorderLlmService recorderLlmService;

    public RecorderPipelineService(
        RecorderDraftStore draftStore,
        RecorderVerifyService verifyService,
        RecorderLlmService recorderLlmService
    ) {
        this.draftStore = draftStore;
        this.verifyService = verifyService;
        this.recorderLlmService = recorderLlmService;
    }

    public Map<String, Object> preview(RecorderSession session, List<String> candidateIds) {
        List<Map<String, Object>> selected = selectCandidates(session, candidateIds);
        return Map.of(
            "prompts", prompts(selected),
            "sentCandidateIds", selected.stream().map(c -> c.get("id")).toList()
        );
    }

    public Map<String, Object> score(RecorderSession session, List<String> candidateIds) {
        return score(session, candidateIds, false);
    }

    public Map<String, Object> score(RecorderSession session, List<String> candidateIds, boolean llmEgressApproved) {
        List<Map<String, Object>> selected = selectCandidates(session, candidateIds);
        String scorePrompt = llmScorePrompt(selected);
        long startedAtNanos = System.nanoTime();
        Map<String, Object> result = new LinkedHashMap<>();
        result.putAll(Map.of(
            "candidates", selected,
            "rejected", List.of(),
            "scorePrompt", scorePrompt,
            "generatePrompt", prompts(selected).get("generate"),
            "screenshotCount", 0,
            "sentCandidateIds", selected.stream().map(c -> c.get("id")).toList()
        ));
        result.put("llmSynthesisUsed", false);
        if (!llmEgressApproved) {
            log.info(
                "recorder_llm_score phase=skipped sessionId={} candidateCount={} approved=false modelCalled=false "
                    + "mergeApplied=false fallback=rule_score_no_approval elapsedMs={}",
                session.sessionId(), selected.size(), elapsedMillis(startedAtNanos)
            );
            return result;
        }
        RecorderLlmService.Availability availability = recorderLlmService.availability();
        if (!availability.available()) {
            result.put("llmError", "默认 LLM 模型不可用，已使用本地规则评分。");
            log.warn(
                "recorder_llm_score phase=skipped sessionId={} candidateCount={} approved=true modelCalled=false "
                    + "availabilityReason={} mergeApplied=false fallback=rule_score_model_unavailable elapsedMs={}",
                session.sessionId(), selected.size(), availability.reason(), elapsedMillis(startedAtNanos)
            );
            return result;
        }
        try {
            log.info(
                "recorder_llm_score phase=calling sessionId={} candidateCount={} approved=true modelCalled=true",
                session.sessionId(), selected.size()
            );
            String llmRawJson = recorderLlmService.generateJsonObject(
                "You are a recorder API analyst. Return one JSON object only, with no thinking, Markdown, or executable code.",
                scorePrompt,
                1200
            );
            result.put("llmRawJson", llmRawJson);
            LlmScoreMergeResult merge = mergeLlmScore(llmRawJson, selected);
            result.put("candidates", merge.candidates());
            result.put("llmAppliedCandidateCount", merge.appliedCandidateCount());
            result.put("llmSynthesisUsed", merge.appliedCandidateCount() > 0);
            if (!merge.jsonParse().isValid()) {
                result.put("llmError", "AI 评分返回格式无效，已使用本地规则评分。");
            } else if (merge.appliedCandidateCount() == 0) {
                result.put("llmError", "AI 评分未匹配当前候选，已使用本地规则评分。");
            }
            log.info(
                "recorder_llm_score phase=received sessionId={} candidateCount={} approved=true modelCalled=true "
                    + "responseLength={} jsonParse={} parseErrorType={} mergeApplied={} appliedCandidateCount={} "
                    + "fallback={} elapsedMs={}",
                session.sessionId(), selected.size(), llmRawJson == null ? 0 : llmRawJson.length(), merge.jsonParse().status(),
                merge.jsonParse().errorType(), merge.appliedCandidateCount() > 0, merge.appliedCandidateCount(),
                merge.fallback(), elapsedMillis(startedAtNanos)
            );
        } catch (RuntimeException e) {
            result.put("llmError", "LLM 评分调用失败，已使用本地规则评分。");
            log.warn(
                "recorder_llm_score phase=call_failed sessionId={} candidateCount={} approved=true modelCalled=true "
                    + "exceptionType={} mergeApplied=false fallback=rule_score_call_failed elapsedMs={}",
                session.sessionId(), selected.size(), e.getClass().getSimpleName(), elapsedMillis(startedAtNanos)
            );
        }
        return result;
    }

    private static long elapsedMillis(long startedAtNanos) {
        return (System.nanoTime() - startedAtNanos) / 1_000_000;
    }

    private static LlmScoreMergeResult mergeLlmScore(String raw, List<Map<String, Object>> candidates) {
        List<Map<String, Object>> mergedCandidates = candidates.stream()
            .map(LinkedHashMap::new)
            .map(candidate -> (Map<String, Object>) candidate)
            .toList();
        LlmJsonParseResult jsonParse = parseJsonObject(raw);
        if (!jsonParse.isValid()) {
            return new LlmScoreMergeResult(mergedCandidates, 0, jsonParse, "rule_score_invalid_llm_json");
        }
        JsonNode scoredCandidates = jsonParse.object().path("candidates");
        if (!scoredCandidates.isArray()) {
            return new LlmScoreMergeResult(mergedCandidates, 0, jsonParse, "rule_score_invalid_llm_schema");
        }
        Map<String, Map<String, Object>> candidateById = new LinkedHashMap<>();
        for (Map<String, Object> candidate : mergedCandidates) {
            candidateById.put(String.valueOf(candidate.get("id")), candidate);
        }
        int applied = 0;
        for (JsonNode scoredCandidate : scoredCandidates) {
            if (!scoredCandidate.isObject()) {
                continue;
            }
            Map<String, Object> candidate = candidateById.get(textValue(scoredCandidate, "candidateId", 200));
            if (candidate == null || !applyLlmSemantics(candidate, scoredCandidate)) {
                continue;
            }
            applied++;
        }
        return new LlmScoreMergeResult(
            mergedCandidates, applied, jsonParse, applied > 0 ? "none" : "rule_score_no_matching_llm_candidate"
        );
    }

    private static boolean applyLlmSemantics(Map<String, Object> candidate, JsonNode scoredCandidate) {
        boolean applied = false;
        Integer utilityScore = boundedInteger(scoredCandidate.get("utilityScore"), 0, 100);
        if (utilityScore != null) {
            candidate.put("llmUtilityScore", utilityScore);
            applied = true;
        }
        String inferredFunction = textValue(scoredCandidate, "inferredFunction", 500);
        if (inferredFunction != null) {
            candidate.put("inferredFunction", inferredFunction);
            applied = true;
        }
        List<Map<String, Object>> paramUnion = paramUnion(scoredCandidate.get("paramUnion"));
        if (!paramUnion.isEmpty()) {
            candidate.put("paramUnion", paramUnion);
            applied = true;
        }
        if (applied) {
            candidate.put("scoredBy", "llm");
        }
        return applied;
    }

    private static List<Map<String, Object>> paramUnion(JsonNode value) {
        if (value == null || !value.isArray()) {
            return List.of();
        }
        List<Map<String, Object>> parameters = new ArrayList<>();
        for (JsonNode parameter : value) {
            String name = textValue(parameter, "name", 100);
            String location = textValue(parameter, "in", 20);
            if (name == null || !List.of("query", "body", "path", "header").contains(location)) {
                continue;
            }
            Map<String, Object> safe = new LinkedHashMap<>();
            safe.put("name", name);
            safe.put("in", location);
            putText(safe, "paramRole", parameter, 200);
            putAllowedText(safe, "exposeAsArg", parameter, List.of("yes", "optional_candidate", "no"));
            putText(safe, "inferredMeaning", parameter, 500);
            putText(safe, "why", parameter, 500);
            parameters.add(safe);
        }
        return parameters;
    }

    private static void putText(Map<String, Object> target, String field, JsonNode source, int maximumLength) {
        String value = textValue(source, field, maximumLength);
        if (value != null) {
            target.put(field, value);
        }
    }

    private static void putAllowedText(Map<String, Object> target, String field, JsonNode source, List<String> allowed) {
        String value = textValue(source, field, 50);
        if (allowed.contains(value)) {
            target.put(field, value);
        }
    }

    private static Integer boundedInteger(JsonNode value, int minimum, int maximum) {
        if (value == null || !value.canConvertToInt()) {
            return null;
        }
        int parsed = value.intValue();
        return parsed >= minimum && parsed <= maximum ? parsed : null;
    }

    private static String textValue(JsonNode object, String field, int maximumLength) {
        if (object == null || !object.isObject() || !object.path(field).isTextual()) {
            return null;
        }
        String value = object.path(field).textValue().trim();
        return value.isEmpty() || value.length() > maximumLength ? null : value;
    }

    private static LlmJsonParseResult parseJsonObject(String raw) {
        if (raw == null || raw.isBlank()) {
            return new LlmJsonParseResult("empty", "none", null);
        }
        try {
            JsonNode parsed = OBJECT_MAPPER.readTree(extractJsonObject(raw));
            return parsed != null && parsed.isObject()
                ? new LlmJsonParseResult("object", "none", parsed)
                : new LlmJsonParseResult("non_object", "none", null);
        } catch (JsonProcessingException e) {
            return new LlmJsonParseResult("invalid", e.getClass().getSimpleName(), null);
        }
    }

    private static String extractJsonObject(String raw) {
        String response = removeLeadingThinking(raw);
        int start = response.indexOf('{');
        if (start < 0) {
            return response;
        }
        boolean inString = false;
        boolean escaped = false;
        int depth = 0;
        for (int index = start; index < response.length(); index++) {
            char character = response.charAt(index);
            if (escaped) {
                escaped = false;
                continue;
            }
            if (character == '\\' && inString) {
                escaped = true;
                continue;
            }
            if (character == '"') {
                inString = !inString;
                continue;
            }
            if (inString) {
                continue;
            }
            if (character == '{') {
                depth++;
            } else if (character == '}' && --depth == 0) {
                return response.substring(start, index + 1);
            }
        }
        return response.substring(start);
    }

    private static String removeLeadingThinking(String raw) {
        String response = raw.trim();
        if (!response.startsWith("<think>")) {
            return response;
        }
        int closingTag = response.indexOf("</think>");
        return closingTag < 0 ? response : response.substring(closingTag + "</think>".length()).trim();
    }

    private record LlmJsonParseResult(String status, String errorType, JsonNode object) {
        private boolean isValid() {
            return object != null;
        }
    }

    private record LlmScoreMergeResult(
        List<Map<String, Object>> candidates,
        int appliedCandidateCount,
        LlmJsonParseResult jsonParse,
        String fallback
    ) {
    }

    public Map<String, Object> generate(RecorderSession session, List<String> candidateIds) {
        List<Map<String, Object>> drafts = draftsFor(session, selectCandidates(session, candidateIds));
        session.drafts(drafts);
        return Map.of("drafts", publicDrafts(drafts));
    }

    public Map<String, Object> pipeline(RecorderSession session, List<String> candidateIds) {
        List<Map<String, Object>> selected = selectCandidates(session, candidateIds);
        List<Map<String, Object>> drafts = draftsFor(session, selected);
        session.drafts(drafts);
        return Map.of(
            "drafts", publicDrafts(drafts),
            "rejected", List.of(),
            "prompts", prompts(selected)
        );
    }

    public Optional<String> verifyDraft(RecorderSession session, String draftId) {
        return verifyDraft(session, draftId, null);
    }

    public Optional<String> verifyDraft(RecorderSession session, String draftId, String source) {
        return draftById(session, draftId).map(draft -> {
            Object token = new Object();
            String sourceToVerify;
            byte[] sourceBytes;
            synchronized (draft) {
                if (draft.containsKey(ACTIVE_VERIFY_TOKEN)) {
                    throw new RecorderVerifyException("invalid_state", "draft " + draftId + " is already being verified");
                }
                sourceToVerify = source == null ? String.valueOf(draft.get("source")) : source;
                try {
                    sourceBytes = validatedSourceBytes(sourceToVerify);
                } catch (IllegalArgumentException e) {
                    throw new RecorderVerifyException("validation_failed", SOURCE_VALIDATION_MESSAGE);
                }
                draft.put(ACTIVE_VERIFY_TOKEN, token);
                draft.remove("verifiedSourceHash");
                draft.remove("verifiedAt");
                draft.put("usable", false);
                draft.put("verify", pendingVerification());
            }
            String sourceHash = sha256(sourceBytes);
            String name = draft.get("site") + "/" + draft.get("name");
            RecorderBycliPaths verificationPaths;
            try {
                verificationPaths = draftStore.write(
                    session.owner(),
                    session.sessionId(),
                    draftId,
                    sourceToVerify
                );
                synchronized (draft) {
                    if (draft.get(ACTIVE_VERIFY_TOKEN) == token) {
                        draft.put("source", sourceToVerify);
                        draft.put("verificationPaths", verificationPaths);
                    }
                }
            } catch (RuntimeException e) {
                updateDraftFailure(session, draft, token, Map.of(), "verify draft write failed");
                throw e;
            }
            String adapterPath = verificationPaths.daemonPath().toString();
            Map<String, Object> verifyArgs = mapValue(draft.get("verifyArgs"));
            Map<String, Object> expectation = mapValue(draft.get("verifyExpectation"));
            try {
                return verifyService.start(
                    session.sessionId(),
                    session.owner(),
                    "pipeline",
                    name,
                    adapterPath,
                    sourceHash,
                    verifyArgs,
                    summary -> {
                        String actualSourceHash = stringValue(summary.get("sourceSha256"));
                        boolean sourceMatches = actualSourceHash != null
                            && actualSourceHash.matches("[0-9a-f]{64}")
                            && sourceHash.equals(actualSourceHash);
                        Map<String, Object> verify = sourceMatches
                            ? verifyService.meetsExpectation(summary, expectation)
                            : sourceHashFailure(summary);
                        boolean usable = Boolean.TRUE.equals(verify.get("ok"));
                        boolean applied = false;
                        Long verifiedAt = null;
                        synchronized (session) {
                            if (!session.state().isTerminal()) {
                                synchronized (draft) {
                                    if (draft.get(ACTIVE_VERIFY_TOKEN) == token) {
                                        draft.put("verify", verify);
                                        draft.put("usable", usable);
                                        if (usable) {
                                            verifiedAt = Instant.now().toEpochMilli();
                                            draft.put("verifiedSourceHash", sourceHash);
                                            draft.put("verifiedAt", verifiedAt);
                                        } else {
                                            draft.remove("verifiedSourceHash");
                                            draft.remove("verifiedAt");
                                        }
                                        draft.remove(ACTIVE_VERIFY_TOKEN);
                                        applied = true;
                                    }
                                }
                            }
                        }
                        Map<String, Object> result = new LinkedHashMap<>();
                        result.put("sessionId", session.sessionId());
                        result.put("draftId", draftId);
                        result.put("verify", verify);
                        result.put("usable", usable);
                        if (applied && usable) {
                            result.put("verifiedSourceHash", sourceHash);
                            result.put("verifiedAt", verifiedAt);
                        }
                        return result;
                    },
                    () -> {},
                    (status, summary) -> {
                        if (!"succeeded".equals(status)) {
                            updateDraftFailure(session, draft, token, summary, "verify runner " + status);
                        }
                    }
                );
            } catch (RecorderVerifyException e) {
                updateDraftFailure(session, draft, token, Map.of(), "verify runner start failed: " + e.getCode());
                throw e;
            } catch (RuntimeException e) {
                updateDraftFailure(session, draft, token, Map.of(), "verify runner start failed");
                throw e;
            }
        });
    }

    public Optional<Map<String, Object>> save(RecorderSession session, String draftId, String source) {
        return draftById(session, draftId).map(draft -> savedDraft(draft, source));
    }

    public String requireVerifiedSource(Map<String, Object> draft, String requestedSource) {
        Object storedSource = draft.get("source");
        String source = requestedSource == null && storedSource instanceof String text ? text : requestedSource;
        Map<String, Object> verify = mapValue(draft.get("verify"));
        Object verifiedHash = draft.get("verifiedSourceHash");
        if (!Boolean.TRUE.equals(draft.get("staticOk"))
            || !Boolean.TRUE.equals(verify.get("ok"))
            || !Boolean.TRUE.equals(draft.get("usable"))
            || !(verifiedHash instanceof String hash)
            || hash.isBlank()) {
            throw new RecorderSaveException("verification_required", "draft verification is required");
        }
        try {
            validatedSourceBytes(source);
        } catch (IllegalArgumentException e) {
            throw new RecorderSaveException("validation_failed", SOURCE_VALIDATION_MESSAGE);
        }
        if (!sha256(source).equals(hash)) {
            throw new RecorderSaveException("source_changed_after_verify", "source changed after verification");
        }
        return source;
    }

    public static String sha256(String source) {
        return sha256(source.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] validatedSourceBytes(String source) {
        if (source == null || source.isBlank()) {
            throw new IllegalArgumentException(SOURCE_VALIDATION_MESSAGE);
        }
        byte[] sourceBytes = source.getBytes(StandardCharsets.UTF_8);
        if (sourceBytes.length > MAX_SOURCE_BYTES) {
            throw new IllegalArgumentException(SOURCE_VALIDATION_MESSAGE);
        }
        return sourceBytes;
    }

    private static String sha256(byte[] source) {
        try {
            return java.util.HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(source)
            );
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    public List<Map<String, Object>> saveMany(RecorderSession session, List<Map<String, Object>> requestedDrafts) {
        List<Map<String, Object>> saved = new ArrayList<>();
        for (Map<String, Object> item : requestedDrafts) {
            Object draftId = item.get("draftId");
            if (draftId instanceof String id) {
                save(session, id, item.get("source") instanceof String source ? source : null).ifPresent(saved::add);
            }
        }
        return saved;
    }

    private List<Map<String, Object>> selectCandidates(RecorderSession session, List<String> candidateIds) {
        if (candidateIds == null || candidateIds.isEmpty()) {
            return session.candidates();
        }
        return session.candidates().stream()
            .filter(candidate -> candidateIds.contains(String.valueOf(candidate.get("id"))))
            .toList();
    }

    private List<Map<String, Object>> draftsFor(RecorderSession session, List<Map<String, Object>> candidates) {
        List<Map<String, Object>> drafts = new ArrayList<>();
        for (int i = 0; i < candidates.size(); i++) {
            Map<String, Object> candidate = candidates.get(i);
            String candidateId = String.valueOf(candidate.get("id"));
            @SuppressWarnings("unchecked")
            Map<String, Object> endpoint = (Map<String, Object>) candidate.getOrDefault("endpoint", Map.of());
            String host = String.valueOf(endpoint.getOrDefault("host", "example.com"));
            String pathname = String.valueOf(endpoint.getOrDefault("pathname", "/search"));
            String commandName = commandName(pathname, i);
            Map<String, Object> draft = new LinkedHashMap<>();
            draft.put("id", "draft_" + i);
            draft.put("candidateId", candidateId);
            draft.put("site", host.replaceAll("[^A-Za-z0-9]+", "_").replaceAll("_+$", ""));
            draft.put("name", commandName);
            String source = sourceFor(candidate, commandName);
            draft.put("source", source);
            draft.put("score", candidate.getOrDefault("score", 80));
            draft.put("confidence", candidate.getOrDefault("confidence", "medium"));
            draft.put("reason", "Generated from captured recorder candidate " + candidateId + ".");
            draft.put("risks", candidate.getOrDefault("risks", List.of()));
            draft.put("notes", List.of("Generated by Java recorder pipeline."));
            draft.put("staticOk", true);
            draft.put("staticViolations", List.of());
            draft.put("verifyArgs", Map.of());
            draft.put("verifyExpectation", Map.of(
                "minRows", 1,
                "expectedFieldCount", 0,
                "expectedStage", "execute"
            ));
            draft.put("verify", Map.of(
                "ok", false,
                "rows", 0,
                "fieldCount", 0,
                "reasons", List.of("pending verification")
            ));
            draft.put("usable", false);
            String savePath = "clis/" + draft.get("site") + "/" + commandName + ".js";
            draft.put("verificationPaths", draftStore.write(session.owner(), session.sessionId(), "draft_" + i, source));
            draft.put("filePath", savePath);
            draft.put("savePath", savePath);
            drafts.add(draft);
        }
        return drafts;
    }

    private Optional<Map<String, Object>> draftById(RecorderSession session, String draftId) {
        return session.drafts().stream()
            .filter(draft -> draftId.equals(draft.get("id")))
            .findFirst();
    }

    List<Map<String, Object>> publicDrafts(List<Map<String, Object>> drafts) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> draft : drafts) {
            Map<String, Object> publicDraft = new LinkedHashMap<>(draft);
            publicDraft.remove("verificationPaths");
            publicDraft.remove(ACTIVE_VERIFY_TOKEN);
            result.add(publicDraft);
        }
        return result;
    }

    private Map<String, Object> savedDraft(Map<String, Object> draft, String source) {
        if (source != null && !source.isBlank()) {
            draft.put("source", source);
        }
        return Map.of(
            "draftId", draft.get("id"),
            "site", draft.get("site"),
            "name", draft.get("name"),
            "adapterPath", draft.get("savePath")
        );
    }

    private Map<String, Object> mapValue(Object value) {
        if (!(value instanceof Map<?, ?> raw)) {
            return Map.of();
        }
        Map<String, Object> mapped = new LinkedHashMap<>();
        raw.forEach((key, item) -> {
            if (key instanceof String text) {
                mapped.put(text, item);
            }
        });
        return mapped;
    }

    private int numberValue(Object value) {
        return value instanceof Number number ? number.intValue() : 0;
    }

    private String stringValue(Object value) {
        return value instanceof String text ? text : null;
    }

    private Map<String, Object> pendingVerification() {
        return Map.of(
            "ok", false,
            "rows", 0,
            "fieldCount", 0,
            "reasons", List.of("pending verification")
        );
    }

    private Map<String, Object> sourceHashFailure(Map<String, Object> summary) {
        Map<String, Object> verify = new LinkedHashMap<>();
        verify.put("ok", false);
        verify.put("rows", numberValue(summary.get("rows")));
        verify.put("fieldCount", numberValue(summary.get("fieldCount")));
        verify.put("reasons", List.of("verified source hash is missing or does not match"));
        return verify;
    }

    private void updateDraftFailure(
        RecorderSession session,
        Map<String, Object> draft,
        Object token,
        Map<String, Object> summary,
        String reason
    ) {
        Map<String, Object> verify = new LinkedHashMap<>();
        verify.put("ok", false);
        verify.put("rows", numberValue(summary.get("rows")));
        verify.put("fieldCount", numberValue(summary.get("fieldCount")));
        verify.put("reasons", List.of(reason));
        synchronized (session) {
            if (session.state().isTerminal()) {
                return;
            }
            synchronized (draft) {
                if (draft.get(ACTIVE_VERIFY_TOKEN) != token) {
                    return;
                }
                draft.put("verify", verify);
                draft.put("usable", false);
                draft.remove("verifiedSourceHash");
                draft.remove("verifiedAt");
                draft.remove(ACTIVE_VERIFY_TOKEN);
            }
        }
    }

    private Map<String, Object> prompts(List<Map<String, Object>> candidates) {
        return Map.of(
            "score", "Score recorder candidates: " + candidates.stream().map(c -> c.get("id")).toList(),
            "generate", "Generate adapter drafts for: " + candidates.stream().map(c -> c.get("id")).toList(),
            "screenshotCount", 0
        );
    }

    private String llmScorePrompt(List<Map<String, Object>> candidates) {
        List<Map<String, Object>> safeCandidates = new ArrayList<>();
        for (Map<String, Object> candidate : candidates) {
            Map<String, Object> endpoint = mapValue(candidate.get("endpoint"));
            Map<String, Object> safe = new LinkedHashMap<>();
            safe.put("id", candidate.get("id"));
            safe.put("method", endpoint.get("method"));
            safe.put("host", endpoint.get("host"));
            safe.put("pathname", endpoint.get("pathname"));
            safe.put("score", candidate.get("score"));
            safeCandidates.add(safe);
        }
        return "Analyze these captured endpoint metadata records. Return exactly one JSON object with this schema: "
            + "{\"candidates\":[{\"candidateId\":string,\"utilityScore\":integer_0_to_100,"
            + "\"inferredFunction\":string,\"paramUnion\":[{\"name\":string,\"in\":\"query|body|path|header\","
            + "\"paramRole\":string,\"exposeAsArg\":\"yes|optional_candidate|no\","
            + "\"inferredMeaning\":string,\"why\":string}]}]}. Do not include secrets or executable code. "
            + "Only use candidateId values from these records: " + safeCandidates;
    }

    private String commandName(String pathname, int index) {
        String cleaned = pathname.replaceAll("[^A-Za-z0-9]+", "_").replaceAll("^_+|_+$", "");
        return cleaned.isBlank() ? "adapter" + index : cleaned;
    }

    private String sourceFor(Map<String, Object> candidate, String commandName) {
        Map<String, Object> endpoint = candidate.get("endpoint") instanceof Map<?, ?> raw
            ? mapValue(raw)
            : Map.of();
        String site = String.valueOf(endpoint.getOrDefault("host", "example.com"))
            .replaceAll("[^A-Za-z0-9]+", "_")
            .replaceAll("_+$", "");
        String method = String.valueOf(endpoint.getOrDefault("method", "GET")).toUpperCase();
        String urlTemplate = String.valueOf(endpoint.getOrDefault(
            "urlTemplate",
            "https://" + endpoint.getOrDefault("host", "example.com") + endpoint.getOrDefault("pathname", "/")
        ));
        String baseUrl = urlTemplate.contains("?") ? urlTemplate.substring(0, urlTemplate.indexOf('?')) : urlTemplate;
        List<Map<String, Object>> args = mapList(candidate.get("args"));
        List<Map<String, Object>> columns = mapList(candidate.get("columns"));
        if (columns.isEmpty()) {
            columns = List.of(Map.of("name", "value"));
        }
        return """
            import { cli, Strategy } from '@sovovs/bycli/registry';
            import { CommandExecutionError, EmptyResultError } from '@sovovs/bycli/errors';

            cli({
              site: %s,
              name: %s,
              access: 'read',
              description: %s,
              strategy: Strategy.PUBLIC,
              browser: false,
              args: %s,
              columns: %s,
              func: async (args) => {
                const url = new URL(%s);
            %s
                let response;
                try {
                  response = await fetch(url, { method: %s, headers: { Accept: 'application/json' } });
                } catch (error) {
                  throw new CommandExecutionError(`request failed: ${error?.message || error}`);
                }
                if (!response.ok) throw new CommandExecutionError(`request failed: HTTP ${response.status}`);
                const data = await response.json();
            %s
                if (!Array.isArray(rows) || rows.length === 0) throw new EmptyResultError(%s, 'API returned no rows');
                return rows.map((item) => (%s));
              },
            });
            """.formatted(
                jsString(site),
                jsString(commandName),
                jsString("Generated recorder adapter for " + site + "/" + commandName),
                sourceArgs(args),
                sourceColumns(columns),
                jsString(baseUrl),
                sourceQueryAssignments(args),
                jsString(method),
                sourceRows(endpoint),
                jsString(site + " " + commandName),
                sourceRow(columns)
            );
    }

    private List<Map<String, Object>> mapList(Object value) {
        if (!(value instanceof List<?> raw)) {
            return List.of();
        }
        return raw.stream().map(this::mapValue).filter(map -> !map.isEmpty()).toList();
    }

    private String sourceArgs(List<Map<String, Object>> args) {
        if (args.isEmpty()) {
            return "[]";
        }
        return "[\n" + args.stream().map(arg -> {
            String name = String.valueOf(arg.getOrDefault("argName", arg.getOrDefault("name", "query")));
            String defaultValue = String.valueOf(arg.getOrDefault("defaultValue", ""));
            return "    { name: " + jsString(name) + ", type: 'string', default: " + jsString(defaultValue)
                + ", help: " + jsString("Captured query parameter " + name) + " },";
        }).collect(java.util.stream.Collectors.joining("\n")) + "\n  ]";
    }

    private String sourceColumns(List<Map<String, Object>> columns) {
        return "[" + columns.stream()
            .map(column -> jsString(String.valueOf(column.getOrDefault("name", "value"))))
            .collect(java.util.stream.Collectors.joining(", ")) + "]";
    }

    private String sourceQueryAssignments(List<Map<String, Object>> args) {
        return args.stream().map(arg -> {
            String name = String.valueOf(arg.getOrDefault("argName", arg.getOrDefault("name", "query")));
            return "    url.searchParams.set(" + jsString(name) + ", String(args." + jsIdentifier(name) + "));";
        }).collect(java.util.stream.Collectors.joining("\n"));
    }

    private String sourceRow(List<Map<String, Object>> columns) {
        return "{ " + columns.stream().map(column -> {
            String name = String.valueOf(column.getOrDefault("name", "value"));
            if ("value".equals(name) && "$[]".equals(column.get("path"))) {
                return "value: typeof item === 'string' ? item : JSON.stringify(item)";
            }
            return jsIdentifier(name) + ": item?." + jsIdentifier(name) + " ?? null";
        }).collect(java.util.stream.Collectors.joining(", ")) + " }";
    }

    private String sourceRows(Map<String, Object> endpoint) {
        String rowPath = stringValue(endpoint.get("rowPath"));
        if (rowPath != null && rowPath.matches("\\$(\\.[A-Za-z_$][A-Za-z0-9_$]*)*\\[\\]")) {
            String expression = "data" + rowPath.substring(1, rowPath.length() - 2).replace(".", "?.");
            return "    const rows = " + expression + ";";
        }
        return """
                const findRows = (value) => {
                  if (Array.isArray(value)) return value;
                  if (!value || typeof value !== 'object') return [];
                  for (const nested of Object.values(value)) {
                    const rows = findRows(nested);
                    if (rows.length) return rows;
                  }
                  return [];
                };
                const rows = findRows(data);""";
    }

    private String jsIdentifier(String value) {
        return value.matches("[A-Za-z_$][A-Za-z0-9_$]*") ? value : "[" + jsString(value) + "]";
    }

    private String jsString(String value) {
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'";
    }
}
