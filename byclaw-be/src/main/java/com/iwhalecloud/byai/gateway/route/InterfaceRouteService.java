package com.iwhalecloud.byai.gateway.route;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
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
 * 处理 createType=FROM_THIRD 且 integrationType=INTERFACE 的外部智能体调用。 直接 POST 到外部智能体的 SSE 地址，逐行解析后通过 PythonSseService
 * 转写到客户端。
 */
@Slf4j
@Service
public class InterfaceRouteService {

    private static final MediaType JSON_TYPE = MediaType.parse("application/json; charset=utf-8");

    private static final int HISTORY_MAX_ROUNDS = 10;

    private static final long CONNECT_TIMEOUT_SECONDS = 30L;

    private static final long READ_TIMEOUT_SECONDS = 600L;

    @Autowired
    private PythonSseService pythonSseService;

    @Autowired
    private ParamService paramService;

    public void route(ChatProcessContext ctx) {
        AgentResourceChatInfoDto agent = findExternalAgent(ctx);
        String url = agent.getAgentSseUrl();
        if (StringUtils.isBlank(url)) {
            writeErrorEvent(ctx, I18nUtil.get("route.interface.sse.url.empty"));
            return;
        }

        Map<String, Object> body = buildRequestBody(ctx, agent);
        Map<String, Object> headers = paramService.getIntegrationHeaders();

        try {
            streamFromExternalAgent(url, body, headers, ctx);
            if (ctx.messageContext != null) {
                ctx.messageContext.setComplete(true);
            }
        }
        catch (BdpRuntimeException e) {
            // PythonSseService 抛出的业务异常（含上游推送的 error 事件），按原样向上抛
            throw e;
        }
        catch (Exception e) {
            log.error("INTERFACE 调用外部智能体失败, sessionId: {}, url: {}", ctx.sessionId, url, e);
            writeErrorEvent(ctx, I18nUtil.get("route.interface.call.failed", e.getMessage()));
        }
    }

    private AgentResourceChatInfoDto findExternalAgent(ChatProcessContext ctx) {
        Long agentId = ctx.getAssistantChatDto().getAgentId();
        @SuppressWarnings("unchecked")
        List<AgentResourceChatInfoDto> agentList = (List<AgentResourceChatInfoDto>) ctx.getParams().get("agent_list");
        if (CollectionUtils.isEmpty(agentList) || agentId == null) {
            throw new BdpRuntimeException(I18nUtil.get("route.interface.agent.not.found"));
        }
        return agentList.stream()
            .filter(a -> agentId.equals(a.getId()) && "FROM_THIRD".equals(a.getCreateType())
                && "INTERFACE".equals(a.getIntegrationType()))
            .findFirst().orElseThrow(() -> new BdpRuntimeException(I18nUtil.get("route.interface.agent.not.found")));
    }

    private Map<String, Object> buildRequestBody(ChatProcessContext ctx, AgentResourceChatInfoDto agent) {
        AssistantChatDto chatDto = ctx.getAssistantChatDto();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("chatContent", chatDto.getChatContent());
        body.put("sessionId", String.valueOf(ctx.sessionId));
        body.put("chatId", String.valueOf(ctx.sessionId));
        body.put("agentId", String.valueOf(agent.getId()));
        body.put("stream", true);
        body.put("redList", Collections.emptyList());
        body.put("blackList", Collections.emptyList());
        body.put("deepThink", Boolean.TRUE.equals(chatDto.getDeepThink()));

        List<Map<String, String>> files = new ArrayList<>();
        if (CollectionUtils.isNotEmpty(chatDto.getFiles())) {
            for (MessageFileDto f : chatDto.getFiles()) {
                Map<String, String> fm = new HashMap<>(2);
                fm.put("fileName", f.getFileName());
                fm.put("fileUrl", f.getFileUrl());
                files.add(fm);
            }
        }
        body.put("files", files);

        Map<String, Object> extParam = chatDto.getExtParams() != null ? new HashMap<>(chatDto.getExtParams())
            : new HashMap<>();
        body.put("extParam", extParam);

        body.put("histories", paramService.getChatHistories(ctx.sessionId, HISTORY_MAX_ROUNDS));
        body.put("versionType", 1);
        return body;
    }

    private void streamFromExternalAgent(String url, Map<String, Object> body, Map<String, Object> headers,
        ChatProcessContext ctx) throws IOException {
        OkHttpClient client = new OkHttpClient.Builder().connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS).writeTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .build();

        String jsonBody = JSON.toJSONString(body);
        Request.Builder reqBuilder = new Request.Builder().url(url).post(RequestBody.create(jsonBody, JSON_TYPE))
            .addHeader("Accept", "*/*");
        if (headers != null) {
            for (Map.Entry<String, Object> entry : headers.entrySet()) {
                if (entry.getValue() != null) {
                    reqBuilder.addHeader(entry.getKey(), String.valueOf(entry.getValue()));
                }
            }
        }

        log.info("INTERFACE 调用外部智能体, sessionId: {}, url: {}, body: {}", ctx.sessionId, url, jsonBody);

        try (Response response = client.newCall(reqBuilder.build()).execute()) {
            if (!response.isSuccessful()) {
                writeErrorEvent(ctx, I18nUtil.get("route.interface.response.error", response.code()));
                return;
            }
            ResponseBody responseBody = response.body();
            if (responseBody == null) {
                writeErrorEvent(ctx, I18nUtil.get("route.interface.response.empty"));
                return;
            }
            consumeSseStream(responseBody.source(), ctx);
        }
    }

    /**
     * 逐行读取上游 SSE 流，将 event:/data: 配对后组装为 {event,data} JSON 行， 复用 PythonSseService.getContentFromPythonStreamV3 处理（写流 +
     * 累计）。
     */
    private void consumeSseStream(BufferedSource source, ChatProcessContext ctx) throws IOException {
        String currentEvent = null;
        StringBuilder dataBuf = new StringBuilder();

        while (!source.exhausted()) {
            String line = source.readUtf8Line();
            if (line == null) {
                break;
            }
            if (line.isEmpty()) {
                // 空行表示一个事件结束
                flushEvent(currentEvent, dataBuf, ctx);
                currentEvent = null;
                dataBuf.setLength(0);
                continue;
            }
            if (line.startsWith(":")) {
                // SSE 注释行
                continue;
            }

            // 参考python,丢掉结束符号
            if (line.endsWith("[DONE]")) {
                break;
            }

            if (line.startsWith("event:")) {
                currentEvent = line.substring("event:".length()).trim();
            }
            else if (line.startsWith("data:")) {
                if (dataBuf.length() > 0) {
                    dataBuf.append('\n');
                }
                dataBuf.append(line.substring("data:".length()).trim());
            }
        }
        // 流结束时若仍有未刷出的事件
        flushEvent(currentEvent, dataBuf, ctx);
    }

    private void flushEvent(String event, StringBuilder dataBuf, ChatProcessContext ctx) {
        if (StringUtils.isBlank(event) || dataBuf.length() == 0) {
            return;
        }
        JSONObject lineJson = new JSONObject();
        lineJson.put("event", event);
        lineJson.put("data", dataBuf.toString());
        pythonSseService.getContentFromPythonStreamV3(lineJson.toJSONString(), ctx.res, ctx.messageContext,
            ctx.getAgentIds(), ctx);
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
