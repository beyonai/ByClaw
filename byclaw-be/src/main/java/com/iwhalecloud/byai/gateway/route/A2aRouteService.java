package com.iwhalecloud.byai.gateway.route;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.feign.request.manager.AgentResourceChatInfoDto;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.ParamService;
import com.iwhalecloud.byai.state.domain.chat.service.PythonSseService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;

import lombok.extern.slf4j.Slf4j;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSource;

/**
 * 处理 createType=FROM_THIRD 且 integrationType=A2A 的外部智能体调用。
 * 流程：拉取 Agent Card → 构造 JSON-RPC message/stream 请求 → 解析 SSE 响应 →
 * 将 Task / Message / TaskStatusUpdate / TaskArtifactUpdate 映射为内部事件格式 →
 * 通过 PythonSseService 转写到客户端。
 */
@Slf4j
@Service
public class A2aRouteService {

    private static final MediaType JSON_TYPE = MediaType.parse("application/json; charset=utf-8");

    private static final long CONNECT_TIMEOUT_SECONDS = 30L;

    private static final long READ_TIMEOUT_SECONDS = 600L;

    /** 仅这几个头需要透传给 A2A 远端 */
    private static final String[] A2A_FORWARD_HEADERS = {"beyond-token", "sso-token", "cookie", "system-code"};


    @Autowired
    private PythonSseService pythonSseService;

    @Autowired
    private ParamService paramService;

    public void route(ChatProcessContext ctx) {
        AgentResourceChatInfoDto agent = findExternalAgent(ctx);
        String cardUrl = agent.getAgentSseUrl();
        if (StringUtils.isBlank(cardUrl)) {
            writeErrorEvent(ctx, I18nUtil.get("route.a2a.sse.url.empty"));
            return;
        }

        Map<String, Object> headers = filterA2aHeaders(paramService.getIntegrationHeaders());

        try {
            JSONObject card = fetchAgentCard(cardUrl, headers);
            String rpcUrl = card.getString("url");
            if (StringUtils.isBlank(rpcUrl)) {
                writeErrorEvent(ctx, I18nUtil.get("route.a2a.card.url.missing"));
                return;
            }

            // 透传 cardUrl 中的 x-api-key 到 rpcUrl（rpcUrl 已携带则跳过）
            rpcUrl = inheritApiKeyFromCardUrl(cardUrl, rpcUrl);

            JSONObject jsonRpc = buildJsonRpcRequest(ctx);
            streamFromA2aAgent(rpcUrl, jsonRpc, headers, ctx);

            if (ctx.messageContext != null) {
                ctx.messageContext.setComplete(true);
            }
        }
        catch (BdpRuntimeException e) {
            throw e;
        }
        catch (Exception e) {
            log.error("A2A 调用外部智能体失败, sessionId: {}, cardUrl: {}", ctx.sessionId, cardUrl, e);
            // writeErrorEvent(ctx, I18nUtil.get("route.a2a.call.failed", e.getMessage()));
        }
    }

    private AgentResourceChatInfoDto findExternalAgent(ChatProcessContext ctx) {
        Long agentId = ctx.getAssistantChatDto().getAgentId();
        @SuppressWarnings("unchecked")
        List<AgentResourceChatInfoDto> agentList =
                (List<AgentResourceChatInfoDto>) ctx.getParams().get("agent_list");
        if (CollectionUtils.isEmpty(agentList) || agentId == null) {
            throw new BdpRuntimeException(I18nUtil.get("route.a2a.agent.not.found"));
        }
        return agentList.stream()
                .filter(a -> agentId.equals(a.getId())
                        && "FROM_THIRD".equals(a.getCreateType())
                        && "A2A".equals(a.getIntegrationType()))
                .findFirst()
                .orElseThrow(() -> new BdpRuntimeException(I18nUtil.get("route.a2a.agent.not.found")));
    }

    private Map<String, Object> filterA2aHeaders(Map<String, Object> all) {
        Map<String, Object> filtered = new HashMap<>(4);
        if (all == null) {
            return filtered;
        }
        for (Map.Entry<String, Object> entry : all.entrySet()) {
            String lower = entry.getKey().toLowerCase();
            for (String allowed : A2A_FORWARD_HEADERS) {
                if (allowed.equals(lower)) {
                    filtered.put(entry.getKey(), entry.getValue());
                    break;
                }
            }
        }
        return filtered;
    }

    /**
     * 若 cardUrl 携带 x-api-key 且 rpcUrl 未携带，则把 x-api-key 拼接到 rpcUrl。
     */
    private String inheritApiKeyFromCardUrl(String cardUrl, String rpcUrl) {
        String apiKey = extractQueryParam(cardUrl, "x-api-key");
        if (StringUtils.isBlank(apiKey)) {
            return rpcUrl;
        }
        if (StringUtils.isNotBlank(extractQueryParam(rpcUrl, "x-api-key"))) {
            return rpcUrl;
        }
        String separator = rpcUrl.contains("?") ? "&" : "?";
        return rpcUrl + separator + "x-api-key=" + apiKey;
    }

    /**
     * 从 URL 的 query string 中取出指定参数（不解码，原样返回）。
     */
    private String extractQueryParam(String url, String key) {
        if (StringUtils.isBlank(url)) {
            return null;
        }
        int qIdx = url.indexOf('?');
        if (qIdx < 0 || qIdx == url.length() - 1) {
            return null;
        }
        String query = url.substring(qIdx + 1);
        int hashIdx = query.indexOf('#');
        if (hashIdx >= 0) {
            query = query.substring(0, hashIdx);
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            String name = eq >= 0 ? pair.substring(0, eq) : pair;
            if (key.equals(name)) {
                return eq >= 0 ? pair.substring(eq + 1) : "";
            }
        }
        return null;
    }

    private JSONObject fetchAgentCard(String cardUrl, Map<String, Object> headers) throws IOException {
        OkHttpClient client = newClient();
        Request.Builder reqBuilder = new Request.Builder().url(cardUrl).get();
        applyHeaders(reqBuilder, headers);

        try (Response response = client.newCall(reqBuilder.build()).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                throw new BdpRuntimeException(I18nUtil.get("route.a2a.card.fetch.failed",
                        response != null ? response.code() : "unknown"));
            }
            String body = response.body().string();
            JSONObject card = JSON.parseObject(body);
            if (card == null) {
                throw new BdpRuntimeException(I18nUtil.get("route.a2a.card.invalid.json", body));
            }
            return card;
        }
    }

    private static final int HISTORY_MAX_ROUNDS = 10;

    /**
     * 拼接历史会话上下文，对齐 Python 的 _handle_context_histories：
     * "Here is the conversation history: \nFor context:\n[user] said: ...\n[assistant] said: ...\n"
     * 历史消息 + 历史用户文件均由 ParamService.getChatHistories 统一处理。
     */
    private String buildHistoryText(ChatProcessContext ctx) {
        if (ctx.assistantChatDto == null || ctx.sessionId == null) {
            return "";
        }
        List<Map<String, String>> histories = paramService.getChatHistories(ctx.sessionId, HISTORY_MAX_ROUNDS);
        if (CollectionUtils.isEmpty(histories)) {
            return "";
        }
        StringBuilder sb = new StringBuilder("Here is the conversation history: \nFor context:\n");
        for (Map<String, String> entry : histories) {
            String role = entry.get("role");
            String content = entry.get("content");
            if (StringUtils.isBlank(content)) {
                continue;
            }
            sb.append("[").append(role).append("] said: ").append(content).append("\n");
        }
        return sb.toString();
    }

    private JSONObject buildJsonRpcRequest(ChatProcessContext ctx) {
        AssistantChatDto chatDto = ctx.getAssistantChatDto();

        JSONArray parts = new JSONArray();

        // 历史上下文：放在 parts 的最前面（与 Python _handle_context_histories 行为一致）
        String histories = buildHistoryText(ctx);
        if (StringUtils.isNotBlank(histories)) {
            JSONObject historyPart = new JSONObject();
            historyPart.put("kind", "text");
            historyPart.put("text", histories);
            parts.add(historyPart);
        }

        JSONObject textPart = new JSONObject();
        textPart.put("kind", "text");
        textPart.put("text", chatDto.getChatContent() == null ? "" : chatDto.getChatContent());
        parts.add(textPart);

        if (CollectionUtils.isNotEmpty(chatDto.getFiles())) {
            for (MessageFileDto f : chatDto.getFiles()) {
                JSONObject filePart = new JSONObject();
                filePart.put("kind", "file");
                JSONObject file = new JSONObject();
                file.put("uri", f.getFileUrl());
                file.put("name", f.getFileName());
                filePart.put("file", file);
                parts.add(filePart);
            }
        }

        JSONObject message = new JSONObject();
        message.put("messageId", UUID.randomUUID().toString());
        message.put("role", "user");
        message.put("parts", parts);
        message.put("contextId", UUID.randomUUID().toString());
        message.put("kind", "message");
        // message.put("taskId", UUID.randomUUID().toString());

        JSONObject params = new JSONObject();
        params.put("message", message);

        JSONObject request = new JSONObject();
        request.put("jsonrpc", "2.0");
        request.put("id", UUID.randomUUID().toString());
        request.put("method", "message/stream");
        request.put("params", params);
        return request;
    }

    private void streamFromA2aAgent(String rpcUrl, JSONObject jsonRpc,
                                    Map<String, Object> headers, ChatProcessContext ctx) throws IOException {
        OkHttpClient client = newClient();
        String jsonBody = jsonRpc.toJSONString();

        Request.Builder reqBuilder = new Request.Builder()
                .url(rpcUrl)
                .post(RequestBody.create(jsonBody, JSON_TYPE))
                .addHeader("Accept", "text/event-stream")
                .addHeader("Content-Type", "application/json");
        applyHeaders(reqBuilder, headers);

        log.info("A2A 调用外部智能体, sessionId: {}, rpcUrl: {}, body: {}", ctx.sessionId, rpcUrl, jsonBody);

        try (Response response = client.newCall(reqBuilder.build()).execute()) {
            if (!response.isSuccessful()) {
                writeErrorEvent(ctx, I18nUtil.get("route.a2a.response.error", response.code()));
                return;
            }
            ResponseBody responseBody = response.body();
            if (responseBody == null) {
                writeErrorEvent(ctx, I18nUtil.get("route.a2a.response.empty"));
                return;
            }
            consumeA2aSseStream(responseBody.source(), ctx);
        }
    }

    /**
     * A2A SSE 一行 data 即一个完整 JSON-RPC 响应。
     */
    private void consumeA2aSseStream(BufferedSource source, ChatProcessContext ctx) throws IOException {
        StringBuilder dataBuf = new StringBuilder();
        while (!source.exhausted()) {
            String line = source.readUtf8Line();
            if (line == null) {
                break;
            }
            if (line.isEmpty()) {
                if (dataBuf.length() > 0) {
                    dispatchA2aChunk(dataBuf.toString(), ctx);
                    dataBuf.setLength(0);
                }
                continue;
            }
            if (line.startsWith(":") || line.startsWith("event:")) {
                continue;
            }
            if (line.startsWith("data:")) {
                String data = line.substring("data:".length()).trim();
                if ("[DONE]".equals(data)) {
                    dispatchA2aChunkEnd(ctx);
                    return;
                }
                if (dataBuf.length() > 0) {
                    dataBuf.append('\n');
                }
                dataBuf.append(data);
            }
        }
        if (dataBuf.length() > 0) {
            dispatchA2aChunk(dataBuf.toString(), ctx);
        }
    }

    private void dispatchA2aChunk(String dataLine, ChatProcessContext ctx) {
        JSONObject jsonRpc;
        try {
            jsonRpc = JSON.parseObject(dataLine);
        }
        catch (Exception e) {
            log.warn("A2A 响应非 JSON, 跳过: {}", dataLine);
            return;
        }
        if (jsonRpc == null) {
            return;
        }

        String internalLine = convertA2aResponseToInternalLine(jsonRpc);
        if (internalLine == null) {
            internalLine = convertOpenAiChunkToInternalLine(jsonRpc);
        }
        if (internalLine == null) {
            return;
        }
        pythonSseService.getContentFromPythonStreamV3(internalLine, ctx.res,
                ctx.messageContext, ctx.getAgentIds(), ctx);
    }

    private void dispatchA2aChunkEnd(ChatProcessContext ctx) {
        pythonSseService.getContentFromPythonStreamV3(wrapLine(SseResponseEventEnum.answerEnd, "{}"), ctx.res,
                ctx.messageContext, ctx.getAgentIds(), ctx);
    }

    /**
     * 将 A2A JSON-RPC 响应映射为 PythonSseService 期望的 {event,data} JSON 行。
     */
    private String convertA2aResponseToInternalLine(JSONObject jsonRpc) {
        JSONObject error = jsonRpc.getJSONObject("error");
        if (error != null) {
            JSONObject errPayload = new JSONObject();
            errPayload.put("message", error.getString("message"));
            errPayload.put("traceback", error.getString("message"));
            errPayload.put("error_code", error.getInteger("code"));
            return wrapLine(SseResponseEventEnum.error, errPayload.toJSONString());
        }

        JSONObject result = jsonRpc.getJSONObject("result");
        if (result == null) {
            return null;
        }

        String kind = result.getString("kind");
        if (StringUtils.isBlank(kind)) {
            // 无 kind 字段时按结构猜测
            if (result.containsKey("artifact")) {
                kind = "artifact-update";
            }
            else if (result.containsKey("history")) {
                kind = "task";
            }
            else if (result.containsKey("status") && result.getJSONObject("status") != null
                    && result.getJSONObject("status").containsKey("state")) {
                kind = "status-update";
            }
            else if (result.containsKey("parts") && result.containsKey("role")) {
                kind = "message";
            }
        }

        if ("task".equalsIgnoreCase(kind)) {
            String text = extractTaskText(result);
            return buildAnswerLine(SseResponseEventEnum.reasoningLogDelta, text, "3005");
        }
        if ("message".equalsIgnoreCase(kind)) {
            String text = extractTextFromParts(result.getJSONArray("parts"));
            return buildAnswerLine(SseResponseEventEnum.answerDelta, text, "1002");
        }
        if ("status-update".equalsIgnoreCase(kind)) {
            JSONObject status = result.getJSONObject("status");
            String state = status != null ? status.getString("state") : null;
            String text = status != null && status.getJSONObject("message") != null
                    ? extractTextFromParts(status.getJSONObject("message").getJSONArray("parts"))
                    : "";
            String contentType = "auth_required".equalsIgnoreCase(state) ? "4003" : "1002";
            return buildAnswerLine(SseResponseEventEnum.answerDelta, text, contentType);
        }
        if ("artifact-update".equalsIgnoreCase(kind)) {
            JSONObject artifact = result.getJSONObject("artifact");
            String text = artifact != null
                    ? extractTextFromParts(artifact.getJSONArray("parts"))
                    : "";
            return buildAnswerLine(SseResponseEventEnum.answerDelta, text, "1002");
        }
        return null;
    }

    /**
     * 兼容 OpenAI Chat Completions 的 data-only SSE chunk：
     * data: {"choices":[{"delta":{"content":"..."}}]}
     * data: [DONE]
     */
    private String convertOpenAiChunkToInternalLine(JSONObject chunk) {
        if (chunk.containsKey("error")) {
            JSONObject error = chunk.getJSONObject("error");
            JSONObject errPayload = new JSONObject();
            errPayload.put("message", error != null ? error.getString("message") : chunk.getString("error"));
            errPayload.put("traceback", errPayload.getString("message"));
            errPayload.put("error_code", error != null ? error.getInteger("code") : null);
            return wrapLine(SseResponseEventEnum.error, errPayload.toJSONString());
        }
        if (!hasOpenAiDeltaContent(chunk)) {
            return null;
        }
        if (!chunk.containsKey("contentType")) {
            chunk.put("contentType", "1002");
        }
        return wrapLine(SseResponseEventEnum.answerDelta, chunk.toJSONString());
    }

    private boolean hasOpenAiDeltaContent(JSONObject chunk) {
        JSONArray choices = chunk.getJSONArray("choices");
        if (choices == null || choices.isEmpty()) {
            return false;
        }
        for (int i = 0; i < choices.size(); i++) {
            JSONObject choice = choices.getJSONObject(i);
            if (choice == null) {
                continue;
            }
            JSONObject delta = choice.getJSONObject("delta");
            if (delta != null && delta.containsKey("content")) {
                return true;
            }
        }
        return false;
    }

    private String extractTaskText(JSONObject task) {
        JSONObject status = task.getJSONObject("status");
        if (status == null) {
            return "";
        }
        JSONObject message = status.getJSONObject("message");
        if (message == null) {
            return "";
        }
        return extractTextFromParts(message.getJSONArray("parts"));
    }

    private String extractTextFromParts(JSONArray parts) {
        if (parts == null || parts.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.size(); i++) {
            JSONObject part = parts.getJSONObject(i);
            if (part == null) {
                continue;
            }
            String partKind = part.getString("kind");
            if ("text".equalsIgnoreCase(partKind)) {
                String text = part.getString("text");
                if (text != null) {
                    sb.append(text);
                }
            }
        }
        return sb.toString();
    }

    private String buildAnswerLine(String event, String content, String contentType) {
        JSONObject delta = new JSONObject();
        delta.put("role", "assistant");
        delta.put("content", content == null ? "" : content);

        JSONObject choice = new JSONObject();
        choice.put("index", 0);
        choice.put("delta", delta);

        JSONArray choices = new JSONArray();
        choices.add(choice);

        JSONObject data = new JSONObject();
        data.put("choices", choices);
        data.put("contentType", contentType);

        return wrapLine(event, data.toJSONString());
    }

    private String wrapLine(String event, String dataJson) {
        JSONObject lineJson = new JSONObject();
        lineJson.put("event", event);
        lineJson.put("data", dataJson);
        return lineJson.toJSONString();
    }

    private OkHttpClient newClient() {
        return new OkHttpClient.Builder()
                .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .writeTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .build();
    }

    private void applyHeaders(Request.Builder reqBuilder, Map<String, Object> headers) {
        if (headers == null) {
            return;
        }
        for (Map.Entry<String, Object> entry : headers.entrySet()) {
            if (entry.getValue() != null) {
                reqBuilder.addHeader(entry.getKey(), String.valueOf(entry.getValue()));
            }
        }
    }

    private void writeErrorEvent(ChatProcessContext ctx, String message) {
        JSONObject errorPayload = new JSONObject();
        errorPayload.put("message", message);
        errorPayload.put("traceback", message);
        errorPayload.put("sessionId", String.valueOf(ctx.sessionId));
        CompletionsUtils.responseWrite(ctx.res, SseResponseEventEnum.error, errorPayload.toJSONString());
        ctx.gatewayError = true;
    }
}
