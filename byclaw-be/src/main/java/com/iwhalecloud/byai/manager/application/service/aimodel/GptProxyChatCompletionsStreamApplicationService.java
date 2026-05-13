package com.iwhalecloud.byai.manager.application.service.aimodel;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.JsonUtil;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import lombok.extern.slf4j.Slf4j;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.sse.EventSource;
import okhttp3.sse.EventSourceListener;
import okhttp3.sse.EventSources;
import org.apache.commons.collections.MapUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * GPT-Proxy chat/completions 流式代理 ApplicationService。
 * 负责：调用上游 SSE 接口并将流式数据透传给前端。
 *
 * <p>安全要求：
 * - Authorization token 仅允许服务端配置，禁止前端传入/透传
 * - 禁止在日志/异常信息中输出 token、sessionId 等敏感信息
 *
 * @author system
 */
@Service
@Slf4j
public class GptProxyChatCompletionsStreamApplicationService {


    @Value("${byai.gptproxy.connectTimeoutMs:30000}")
    private int gptProxyConnectTimeoutMs;

    @Autowired
    private ModelManagementApplicationService modelManagementApplicationService;

    /**
     * 流式调试：若请求体带有效 id，则按流结束/异常结果更新模型状态（Story：成功 OOA+Redis，失败 OOD）。
     */
    public SseEmitter startChatCompletionsStreamTest(Map<String, Object> body) {
        Long modelId = modelManagementApplicationService.parseModelIdFromBody(body);
        AtomicBoolean statusUpdated = new AtomicBoolean(false);
        SseEmitter emitter = new SseEmitter(0L);
        OkHttpClient client = buildStreamClient();
        Request request = buildStreamRequest(body);
        AtomicReference<EventSource> ref = new AtomicReference<>();
        registerEmitterCallbacks(emitter, ref, modelId, statusUpdated);
        ref.set(EventSources.createFactory(client).newEventSource(request,
                createStreamListener(emitter, modelId, statusUpdated)));
        return emitter;
    }

    private OkHttpClient buildStreamClient() {
        return new OkHttpClient.Builder()
                .connectTimeout(gptProxyConnectTimeoutMs, TimeUnit.MILLISECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .build();
    }

    private Request buildStreamRequest(Map<String, Object> body) {
        MediaType json = MediaType.get("application/json; charset=utf-8");
        String inputJson = MapUtils.getString(body, "input");
        Map<String, Object> inputMap = JSONObject.parseObject(inputJson);
        String url = MapUtils.getString(inputMap, "url");
        Map<String, Object> headersMap = MapUtils.getMap(inputMap, "headers");
        removeAdditionParam(inputMap);
        RequestBody requestBody = RequestBody.create(JsonUtil.toJSONString(inputMap), json);
        Request.Builder builder = new Request.Builder()
                .url(url)
                .post(requestBody)
                .addHeader("Accept", "text/event-stream")
                .addHeader("Content-Type", "application/json");
        buildHeader(headersMap, builder);
        return builder.build();
    }

    private void onStreamEnd(AtomicReference<EventSource> ref, Long modelId, AtomicBoolean statusUpdated, boolean success) {
        EventSource es = ref.get();
        if (es != null) {
            es.cancel();
        }
        if (modelId != null && statusUpdated.compareAndSet(false, true)) {
            modelManagementApplicationService.updateModelStatusAfterDebug(modelId, success);
        }
    }

    private void registerEmitterCallbacks(SseEmitter emitter, AtomicReference<EventSource> ref,
                                          Long modelId, AtomicBoolean statusUpdated) {
        emitter.onCompletion(() -> onStreamEnd(ref, modelId, statusUpdated, true));
        emitter.onTimeout(() -> {
            onStreamEnd(ref, modelId, statusUpdated, false);
            emitter.complete();
        });
        emitter.onError(e -> onStreamEnd(ref, modelId, statusUpdated, false));
    }

    private EventSourceListener createStreamListener(SseEmitter emitter, Long modelId, AtomicBoolean statusUpdated) {
        return new EventSourceListener() {
            @Override
            public void onEvent(EventSource eventSource, String id, String type, String data) {
                try {
                    emitter.send(SseEmitter.event().data(data, org.springframework.http.MediaType.TEXT_PLAIN));
                    if ("[DONE]".equals(data)) {
                        emitter.complete();
                        eventSource.cancel();
                    }
                } catch (IOException ex) {
                    eventSource.cancel();
                    emitter.complete();
                }
            }

            @Override
            public void onClosed(EventSource eventSource) {
                emitter.complete();
            }

            @Override
            public void onFailure(EventSource eventSource, Throwable t, Response response) {
                if (modelId != null && statusUpdated.compareAndSet(false, true)) {
                    modelManagementApplicationService.updateModelStatusAfterDebug(modelId, false);
                }
                // 以 BaseException 抛出调用接口报的错，禁止透传堆栈/内部信息
                BaseException baseEx = buildUpstreamFailureException(t, response);
                emitter.completeWithError(baseEx);
            }
        };
    }

    private void removeAdditionParam(Map<String, Object> body) {
        body.remove("url");
        body.remove("headers");
    }

    private void buildHeader(Map<String, Object> headersMap, Request.Builder requestBuilder) {
        if (MapUtils.isNotEmpty(headersMap)) {
            for (Map.Entry<String, Object> entry : headersMap.entrySet()) {
                requestBuilder.addHeader(entry.getKey(), entry.getValue().toString());
            }
        }
    }

    /**
     * 根据上游 Response 或 Throwable 构造 BaseException，供 onFailure 时 completeWithError 使用；禁止携带堆栈/敏感信息。
     */
    private BaseException buildUpstreamFailureException(Throwable t, Response response) {
        int errorCode = CommonErrorCode.AIMODEL_ERROR_CODE_50010;
        if (response != null) {
            int code = response.code();
            errorCode = code >= 400 && code < 500
                ? CommonErrorCode.AIMODEL_ERROR_CODE_40001
                : CommonErrorCode.AIMODEL_ERROR_CODE_50010;
        }
        return new BaseException(errorCode, "aimodel.debug.upstream.error", t);
    }
}

