package com.iwhalecloud.byai.manager.application.service.aimodel;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.mapper.aimodel.ByaiAimodelMapper;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/** Read-only probes. Never enable/disable a model or persist provider response bodies. */
@Service
public class ModelHealthApplicationService {
    private final ByaiAimodelMapper mapper;
    private final OkHttpClient client;
    private final ModelHealthCache cache;

    public ModelHealthApplicationService(ByaiAimodelMapper mapper, ModelHealthCache cache) {
        this.cache = cache;
        this.mapper = mapper;
        this.client = OkHttpUtil.getHttpClient().newBuilder()
            .connectTimeout(5, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS)
            .callTimeout(12, TimeUnit.SECONDS).retryOnConnectionFailure(false)
            .followRedirects(false).followSslRedirects(false).build();
    }

    public record Item(String modelId, String modelName, String modelType, String status,
                       String errorCode, String endpoint, Integer httpStatus, boolean enabled) { }
    public record Report(String scope, long checkedAt, boolean healthy, List<Item> models,
                         long loginCheckedAt, boolean presented, boolean dismissed, String focusModelId) {
        public Report(String scope, long checkedAt, boolean healthy, List<Item> models) {
            this(scope, checkedAt, healthy, models, 0, false, false, null);
        }
    }

    private void authenticated() {
        if (CurrentUserHolder.getLoginInfo() == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    }

    private String scope(String scope) {
        authenticated();
        if (scope == null || !List.of("PERSONAL", "PUBLIC").contains(scope)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        return scope;
    }

    private ByaiAimodel writable(Long id) {
        authenticated();
        if (id == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        ByaiAimodel model = mapper.selectById(id);
        if (model == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        boolean own = "PERSONAL".equals(model.getOwnerType())
            && Objects.equals(CurrentUserHolder.getCurrentUserId(), model.getCreateBy());
        if (!own && !(CurrentUserHolder.isAdminVip() && "PUBLIC".equals(model.getOwnerType()))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        return model;
    }

    /** Cache-only reads may prune confirmed deletions, but never call an upstream model. */
    public Report cached(String requestedScope) {
        String scope = scope(requestedScope);
        Report report = cache.read(scope);
        if (report != null) for (Item item : report.models()) {
            if (item.modelId() == null) continue;
            ByaiAimodel model = mapper.selectById(Long.valueOf(item.modelId()));
            if (model == null || !scope.equals(model.getOwnerType()) || "PERSONAL".equals(scope)
                && !Objects.equals(CurrentUserHolder.getCurrentUserId(), model.getCreateBy())) {
                remove(scope, item.modelId());
            }
        }
        return cache.withNotice(cache.read(scope), false);
    }

    public void acknowledge(String requestedScope, long checkedAt, boolean dismissed) {
        cache.notice(scope(requestedScope), checkedAt, true, dismissed);
    }

    public void removeDeleted(String id) {
        authenticated();
        // A stale link is allowed to prune only when the database confirms deletion.
        if (mapper.selectById(Long.valueOf(id)) != null) return;
        remove("PERSONAL", id);
        remove("PUBLIC", id);
    }

    private void remove(String scope, String id) {
        long revision = cache.begin(scope, id);
        if (cache.read(scope) == null) return;
        cache.update(scope, id, revision, previous -> {
            List<Item> items = previous.models().stream().filter(item -> !id.equals(item.modelId())).toList();
            return new Report(scope, previous.checkedAt(), healthy(items), items, previous.loginCheckedAt(),
                previous.presented(), previous.dismissed(), id.equals(previous.focusModelId()) ? null : previous.focusModelId());
        });
    }

    public long beginDebug(Long id) {
        ByaiAimodel model = writable(id);
        return cache.begin(model.getOwnerType(), id.toString());
    }

    public Report completeDebug(Long id, long revision, boolean success) {
        ByaiAimodel model = writable(id);
        String scope = model.getOwnerType();
        Report old = cache.withNotice(cache.read(scope), false);
        Item item = item(model, success ? null : "DEBUG_FAILED", safeOrigin(model.getUrl()), null);
        Report next = cache.update(scope, id.toString(), revision,
            previous -> merge(previous, new Report(scope, System.currentTimeMillis(), success, List.of(item)), id, true));
        if (next != null) cache.notice(scope, next.checkedAt(), true, old == null || old.dismissed());
        return cache.withNotice(next, false);
    }

    public Report check(Long id) { return check(id, false); }

    public Report check(Long id, boolean force) {
        authenticated();
        String scope = id == null ? (CurrentUserHolder.isAdminVip() ? "PUBLIC" : "PERSONAL") : writable(id).getOwnerType();
        if (id != null) {
            long revision = cache.begin(scope, id.toString());
            Report result = executeCheck(id);
            // A deletion while a probe was running must never restore its stale result.
            if (mapper.selectById(id) == null) { remove(scope, id.toString()); return cached(scope); }
            Report next = cache.update(scope, id.toString(), revision, previous -> merge(previous, result, id, false));
            if (next != null && next.focusModelId() == null) cache.notice(scope, next.checkedAt(), true, true);
            return cache.withNotice(next, true);
        }
        Report previous = cached(scope);
        if (!force && fresh(previous)) return cache.withNotice(previous, true);
        String token = UUID.randomUUID().toString();
        if (!cache.acquireLogin(scope, token)) return cache.withNotice(previous, false);
        try {
            previous = cache.read(scope);
            if (!force && fresh(previous)) return cache.withNotice(previous, true);
            long revision = cache.begin(scope, null);
            Report result = executeCheck(null);
            Report next = cache.update(scope, null, revision, current -> {
                long now = Math.max(result.checkedAt(), current == null ? 0 : current.checkedAt() + 1);
                return new Report(scope, now, result.healthy(), result.models(), now, false, false, null);
            });
            return cache.withNotice(next, true);
        } finally {
            cache.releaseLogin(scope, token);
        }
    }

    private boolean fresh(Report report) {
        long age = report == null ? -1 : System.currentTimeMillis() - report.loginCheckedAt();
        return age >= 0 && age < ModelHealthCache.DAY;
    }

    private boolean healthy(List<Item> items) { return items.stream().noneMatch(item -> "FAILED".equals(item.status())); }

    private Report merge(Report previous, Report result, Long id, boolean debug) {
        List<Item> items = new ArrayList<>(result.models());
        Item target = result.models().getFirst();
        if (previous != null) items.addAll(previous.models().stream().filter(item -> !id.toString().equals(item.modelId())
            && !("MODEL_NOT_CONFIGURED".equals(item.errorCode()) && target.enabled()
            && item.modelType().equals(target.modelType()))).toList());
        long now = Math.max(result.checkedAt(), previous == null ? 0 : previous.checkedAt() + 1);
        return new Report(result.scope(), now, healthy(items), items, previous == null ? 0 : previous.loginCheckedAt(),
            debug || !"FAILED".equals(target.status()), debug, !debug && "FAILED".equals(target.status()) ? id.toString() : null);
    }

    private Report executeCheck(Long modelId) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (CurrentUserHolder.getLoginInfo() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        boolean admin = CurrentUserHolder.isAdminVip();
        String scope = admin ? "PUBLIC" : "PERSONAL";
        List<ByaiAimodel> models;
        if (modelId != null) {
            ByaiAimodel model = mapper.selectById(modelId);
            if (model == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            boolean own = "PERSONAL".equals(model.getOwnerType()) && Objects.equals(userId, model.getCreateBy());
            if (!own && !(admin && "PUBLIC".equals(model.getOwnerType()))) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN);
            }
            scope = model.getOwnerType();
            models = List.of(model);
        } else {
            models = mapper.selectByCondition("OOA", null, null, null, null, null, null,
                admin ? null : userId, scope).stream()
                .filter(model -> "LLM".equals(model.getModelType())
                    || admin && "EMBEDDING".equals(model.getModelType())).toList();
        }
        List<Item> items = new ArrayList<>();
        for (ByaiAimodel model : models) items.add(probe(model));
        if (modelId == null) {
            if (models.stream().noneMatch(model -> "LLM".equals(model.getModelType()))) {
                // Personal models are optional. An empty personal scope is healthy and stays silent.
                if (admin) {
                    items.add(new Item(null, null, "LLM", "FAILED", "MODEL_NOT_CONFIGURED", null, null, false));
                }
            }
            if (admin && models.stream().noneMatch(model -> "EMBEDDING".equals(model.getModelType()))) {
                items.add(new Item(null, null, "EMBEDDING", "FAILED", "MODEL_NOT_CONFIGURED", null, null, false));
            }
        }
        return new Report(scope, System.currentTimeMillis(), items.stream().noneMatch(i -> "FAILED".equals(i.status())), items);
    }

    Item probe(ByaiAimodel model) {
        String endpoint = safeOrigin(model.getUrl());
        try {
            URI uri = URI.create(model.getUrl());
            if (uri.getHost() == null || !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                return item(model, "INVALID_URL", endpoint, null);
            }
            if (model.getModelNo() == null || model.getModelNo().isBlank()) return item(model, "MODEL_CODE_MISSING", endpoint, null);
            String type = model.getModelType();
            // Media probes would create billable images/audio. Only text, embedding and rerank use tiny inference.
            if (!List.of("LLM", "EMBEDDING", "RERANK").contains(type)) {
                return new Item(model.getModelId().toString(), model.getModelName(), type, "SKIPPED",
                    "MANUAL_DEBUG_REQUIRED", endpoint, null, "OOA".equals(model.getStatus()));
            }
            JSONObject config = model.getInParams() == null ? new JSONObject() : JSONObject.parseObject(model.getInParams());
            if (config == null) config = new JSONObject();
            String protocol = config.getString("modelProtocol");
            if (protocol == null) protocol = model.getModelProtocol();
            boolean anthropic = "Anthropic".equalsIgnoreCase(protocol);
            boolean responses = "OpenAI Responses".equalsIgnoreCase(protocol);
            boolean qwenEmbedding = "EMBEDDING".equals(type) && "Qwen".equalsIgnoreCase(protocol);
            boolean arkEmbedding = "EMBEDDING".equals(type) && "Volcengine Multimodal".equalsIgnoreCase(protocol);
            String suffix = "EMBEDDING".equals(type) ? "/embeddings" : "RERANK".equals(type) ? "/rerank"
                : anthropic ? "/v1/messages" : responses ? "/responses" : "/chat/completions";
            String url = model.getUrl().replaceAll("/+$", "");
            if (!qwenEmbedding && !arkEmbedding && !url.endsWith(suffix) && !(anthropic && url.endsWith("/messages"))) {
                if (anthropic && url.endsWith("/v1")) suffix = "/messages";
                url += suffix;
            }
            JSONObject body = new JSONObject();
            body.put("model", model.getModelNo());
            if ("EMBEDDING".equals(type)) {
                body.put("input", qwenEmbedding ? Map.of("contents", List.of(Map.of("text", "ping")))
                    : arkEmbedding ? List.of(Map.of("type", "text", "text", "ping")) : List.of("ping"));
                if (arkEmbedding) body.put("encoding_format", "float");
            } else if ("RERANK".equals(type)) {
                body.put("query", "ping"); body.put("documents", List.of("ping")); body.put("top_n", 1);
            } else {
                body.put("stream", true);
                applyProbeThinking(body, config, model.getModelNo(), anthropic, responses);
                if (responses) {
                    body.put("input", "Reply OK"); body.put("max_output_tokens", 16);
                } else {
                    body.put("messages", List.of(Map.of("role", "user", "content", "Reply OK")));
                    String code = model.getModelNo().toLowerCase(Locale.ROOT);
                    boolean completionLimit = !anthropic && (code.startsWith("gpt-5") || code.matches("o[134]([-_].*)?"));
                    body.put(completionLimit ? "max_completion_tokens" : "max_tokens", 16);
                }
            }
            Request.Builder builder = new Request.Builder().url(url)
                .post(RequestBody.create(body.toJSONString(), MediaType.get("application/json")))
                .header("Accept", "LLM".equals(type) ? "text/event-stream" : "application/json");
            String token = decrypt(model.getAuthToken());
            if (token != null && !token.isBlank()) {
                builder.header(anthropic ? "x-api-key" : "Authorization", anthropic ? token : "Bearer " + token);
            }
            if (anthropic) builder.header("anthropic-version", "2023-06-01");
            JSONArray headers = config.getJSONArray("headers");
            if (headers != null) for (int i = 0; i < headers.size(); i++) {
                JSONObject header = headers.getJSONObject(i);
                String name = header.getString("key");
                String value = header.getString("value");
                if (name != null && !name.isBlank() && value != null
                    && !List.of("host", "content-length", "content-type").contains(name.toLowerCase(Locale.ROOT))) {
                    builder.header(name, value);
                }
            }
            try (Response response = client.newCall(builder.build()).execute()) {
                if (!response.isSuccessful()) return item(model, switch (response.code()) {
                    case 401, 403 -> "AUTH_FAILED";
                    case 402 -> "QUOTA_EXCEEDED";
                    case 404 -> "MODEL_OR_ENDPOINT_NOT_FOUND";
                    case 429 -> "RATE_LIMITED";
                    default -> response.code() >= 500 ? "PROVIDER_UNAVAILABLE" : "REQUEST_REJECTED";
                }, endpoint, response.code());
                if ("LLM".equals(type)) {
                    String contentType = response.header("Content-Type", "");
                    String error;
                    if (response.body() == null) error = "EMPTY_RESPONSE";
                    else if (contentType.toLowerCase(Locale.ROOT).contains("text/event-stream")) error = streamError(response);
                    else {
                        JSONObject data = parsePayload(response.body().string());
                        error = data != null && failedResponse(data) ? "UPSTREAM_ERROR" : "INVALID_RESPONSE";
                    }
                    return item(model, error, endpoint, response.code());
                }
                JSONObject data = response.body() == null ? null : JSONObject.parseObject(response.body().string());
                if (failedResponse(data)) return item(model, "INVALID_RESPONSE", endpoint, response.code());
                boolean valid;
                if ("EMBEDDING".equals(type)) {
                    JSONObject output = data.getJSONObject("output");
                    JSONArray vectors = qwenEmbedding && output != null ? output.getJSONArray("embeddings")
                        : data.getJSONArray("data");
                    valid = vectors != null && !vectors.isEmpty()
                        && vectors.getJSONObject(0).getJSONArray("embedding") != null
                        && !vectors.getJSONObject(0).getJSONArray("embedding").isEmpty();
                } else {
                    String field = "RERANK".equals(type) ? "results" : anthropic ? "content" : responses ? "output" : "choices";
                    JSONArray output = data.getJSONArray(field);
                    valid = output != null && !output.isEmpty();
                }
                return item(model, valid ? null : "INVALID_RESPONSE", endpoint, response.code());
            }
        } catch (InterruptedIOException e) {
            return item(model, "TIMEOUT", endpoint, null);
        } catch (IOException e) {
            return item(model, "CONNECTION_FAILED", endpoint, null);
        } catch (Exception e) {
            return item(model, "INVALID_CONFIG_OR_RESPONSE", endpoint, null);
        }
    }

    /** Basic availability only: avoid spending the tiny output budget on optional thinking. */
    private void applyProbeThinking(JSONObject body, JSONObject config, String modelCode, boolean anthropic, boolean responses) {
        if (responses) return; // Responses has no portable thinking-off switch.
        JSONObject reasoning = config.getJSONObject("reasoningConfig");
        String format = reasoning == null ? "auto" : reasoning.getString("compatFormat");
        String code = modelCode.toLowerCase(Locale.ROOT);
        if (!anthropic && (code.startsWith("gpt-") || code.matches("o[134]([-_].*)?"))) return;
        if (anthropic || "deepseek".equals(format)) {
            body.put("thinking", Map.of("type", "disabled"));
        } else if ("bailian".equals(format) || "qwen".equals(format)) {
            body.put("enable_thinking", false);
        } else if ("qwen-chat-template".equals(format)) {
            body.put("chat_template_kwargs", Map.of("enable_thinking", false));
        } else if ("together".equals(format)) {
            body.put("reasoning", Map.of("enabled", false));
        } else if (format == null || "auto".equals(format)) {
            // Match the existing debug request's legacy OpenAI-compatible switches.
            body.put("enable_thinking", false);
            body.put("chat_template_kwargs", Map.of("enable_thinking", false));
        }
    }

    /** Consume all events, including errors after text or [DONE]. Never retain provider payloads. */
    private String streamError(Response response) throws IOException {
        BufferedReader reader = new BufferedReader(response.body().charStream());
        StringBuilder data = new StringBuilder();
        String event = "";
        ProbeStream result = new ProbeStream();
        String line;
        while ((line = reader.readLine()) != null) {
            if (line.startsWith("event:")) {
                if (!data.isEmpty()) { result.accept(event, data.toString()); data.setLength(0); }
                event = line.substring(6).trim();
                if ("error".equals(event)) result.error = "UPSTREAM_ERROR";
            }
            else if (line.startsWith("data:")) {
                // Some compatible providers omit blank SSE separators between complete JSON lines.
                if (!data.isEmpty() && ("[DONE]".contentEquals(data) || parsePayload(data.toString()) != null)) {
                    result.accept(event, data.toString()); data.setLength(0); event = "";
                }
                if (!data.isEmpty()) data.append('\n');
                data.append(line.substring(5).trim());
            } else if (line.isBlank()) {
                if (!data.isEmpty()) { result.accept(event, data.toString()); data.setLength(0); }
                event = "";
            }
        }
        if (!data.isEmpty()) result.accept(event, data.toString());
        return result.error != null ? result.error : result.content ? null
            : result.limited ? "PROBE_OUTPUT_LIMIT" : "EMPTY_RESPONSE";
    }

    private JSONObject parsePayload(String value) {
        try { return JSONObject.parseObject(value); }
        catch (RuntimeException e) { return null; }
    }

    private class ProbeStream {
        private boolean content;
        private boolean limited;
        private String error;

        void accept(String event, String raw) {
            if ("[DONE]".equals(raw)) return;
            JSONObject payload = parsePayload(raw);
            if (payload == null) { error = "INVALID_RESPONSE"; return; }
            JSONObject response = payload.getJSONObject("response");
            JSONObject details = response == null ? null : response.getJSONObject("incomplete_details");
            boolean tokenLimit = "response.incomplete".equals(payload.getString("type"))
                && details != null && "max_output_tokens".equals(details.getString("reason"));
            if ("error".equals(event) || failedResponse(payload) && !tokenLimit
                || response != null && (response.containsKey("error") && response.get("error") != null
                    || "failed".equals(response.getString("status")))) {
                error = "UPSTREAM_ERROR";
                return;
            }
            limited |= tokenLimit;
            JSONObject delta = payload.get("delta") instanceof JSONObject object ? object : null;
            limited |= delta != null && "max_tokens".equals(delta.getString("stop_reason"));
            JSONArray choices = payload.getJSONArray("choices");
            if (choices != null && !choices.isEmpty()) {
                limited |= "length".equals(choices.getJSONObject(0).getString("finish_reason"));
            }
            content |= streamHasContent(payload);
        }
    }

    private boolean failedResponse(JSONObject data) {
        if (data == null || data.containsKey("error") || Boolean.FALSE.equals(data.getBoolean("success"))) return true;
        if (data.containsKey("code") && !"0".equals(data.getString("code"))) return true;
        String type = data.getString("type");
        return type != null && List.of("error", "response.failed", "response.incomplete").contains(type)
            || "failed".equals(data.getString("status"));
    }

    private boolean streamHasContent(JSONObject data) {
        if (List.of("response.output_text.delta", "response.reasoning_text.delta", "response.reasoning_summary_text.delta")
            .contains(data.getString("type") == null ? "" : data.getString("type"))) return hasText(data.get("delta"));
        JSONObject delta = data.get("delta") instanceof JSONObject object ? object : null;
        if (delta != null && (hasText(delta.get("text")) || hasText(delta.get("thinking")))) return true;
        JSONObject block = data.getJSONObject("content_block");
        if (block != null && (hasText(block.get("text")) || hasText(block.get("thinking")))) return true;
        JSONArray choices = data.getJSONArray("choices");
        if (choices == null || choices.isEmpty()) return false;
        JSONObject choice = choices.getJSONObject(0);
        JSONObject message = choice.getJSONObject("delta");
        if (message == null) message = choice.getJSONObject("message");
        return message != null && (hasText(message.get("content")) || hasText(message.get("reasoning_content"))
            || hasText(message.get("reasoning")));
    }

    private boolean hasText(Object value) {
        return value instanceof String text && !text.isBlank();
    }

    private Item item(ByaiAimodel model, String error, String endpoint, Integer status) {
        return new Item(model.getModelId().toString(), model.getModelName(), model.getModelType(),
            error == null ? "HEALTHY" : "FAILED", error, endpoint, status, "OOA".equals(model.getStatus()));
    }

    private String decrypt(String token) {
        if (token == null || token.isBlank()) return token;
        try { return Sm4Util.decrypt(token); } catch (Exception e) { return token; }
    }

    private String safeOrigin(String url) {
        try {
            URI uri = URI.create(url);
            return uri.getHost() == null ? null : new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), null, null, null).toString();
        } catch (Exception e) { return null; }
    }
}
