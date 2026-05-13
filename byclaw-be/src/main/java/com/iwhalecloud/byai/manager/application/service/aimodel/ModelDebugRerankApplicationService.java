package com.iwhalecloud.byai.manager.application.service.aimodel;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import java.net.URI;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import lombok.extern.slf4j.Slf4j;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.apache.commons.collections.MapUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 模型调试 RERANK 代理 ApplicationService（非流式）。
 *
 * <p>说明：
 * <ul>
 *   <li>入参形态与 debugModelStream 保持一致：body.input 内包含 url/headers 与其余 param</li>
 *   <li>使用 OkHttp 以 POST JSON 方式调用上游，返回上游 status/content-type/body</li>
 *   <li>日志禁止打印敏感 header 与请求体原文</li>
 * </ul>
 *
 * @author system
 */
@Service
@Slf4j
public class ModelDebugRerankApplicationService {

    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");
    private static final String DEFAULT_ACCEPT = "application/json, */*";
    private static final String DEFAULT_CONTENT_TYPE = "application/json";

    @Value("${byai.gptproxy.connectTimeoutMs:30000}")
    private int connectTimeoutMs;

    @Value("${byai.gptproxy.readTimeoutMs:0}")
    private int readTimeoutMs;

    /**
     * RERANK 调试代理：调用上游并返回结果（非流式）。
     *
     * @param body 请求体（与 debugModelStream 兼容）
     * @return 上游响应透传结果
     */
    public RerankDebugResult startRerankDebug(Map<String, Object> body) {
        String inputJson = MapUtils.getString(body, "input");
        if (StringUtil.isEmpty(inputJson)) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.debug.rerank.input.required");
        }

        Map<String, Object> inputMap = JSONObject.parseObject(inputJson);

        if (MapUtils.isEmpty(inputMap)) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.debug.rerank.input.required");
        }

        String url = MapUtils.getString(inputMap, "url");
        if (StringUtil.isEmpty(url)) {
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.debug.rerank.url.required");
        }

        // headers 为可选，透传给上游；注意：禁止在日志中打印 header 明文（可能包含 token/cookie）
        Map<String, Object> headersMap = MapUtils.getMap(inputMap, "headers");

        // 将 url/headers 从请求体中移除，剩余字段作为上游 param body
        inputMap.remove("url");
        inputMap.remove("headers");
        String upstreamBodyJson = JsonUtil.toJSONString(inputMap);

        OkHttpClient client = buildClient();
        Request request;
        try {
            request = buildRequest(url, headersMap, upstreamBodyJson);
        } catch (IllegalArgumentException e) {
            // URL 非法等场景
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_40001, "aimodel.debug.rerank.url.required");
        }

        try (Response response = client.newCall(request).execute()) {
            int statusCode = response.code();
            String contentType = response.header("Content-Type");
            if (StringUtil.isEmpty(contentType)) {
                contentType = DEFAULT_CONTENT_TYPE;
            }
            ResponseBody responseBody = response.body();
            String bodyStr = responseBody == null ? "" : responseBody.string();


            // 上游返回非 2xx 时直接抛出 BaseException，便于前端拿到调用接口报的错
            if (statusCode < 200 || statusCode >= 300) {
                int errorCode = statusCode >= 400 && statusCode < 500
                    ? CommonErrorCode.AIMODEL_ERROR_CODE_40001
                    : CommonErrorCode.AIMODEL_ERROR_CODE_50010;
                throw new BaseException(errorCode, "aimodel.debug.upstream.error");
            }

            return RerankDebugResult.builder()
                .statusCode(statusCode)
                .contentType(contentType)
                .body(bodyStr)
                .build();
        } catch (BaseException e) {
            throw e;
        } catch (Exception e) {
            log.error("rerank debug proxy fail, host={}", safeHost(url), e);
            throw new BaseException(CommonErrorCode.AIMODEL_ERROR_CODE_50010, "aimodel.debug.rerank.call.failed", e);
        }
    }

    private OkHttpClient buildClient() {
        return new OkHttpClient.Builder()
            .connectTimeout(connectTimeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS)
            .build();
    }

    private Request buildRequest(String url, Map<String, Object> headersMap, String upstreamBodyJson) {
        RequestBody requestBody = RequestBody.create(upstreamBodyJson, JSON_MEDIA_TYPE);
        Request.Builder builder = new Request.Builder()
            .url(url)
            .post(requestBody)
            // 固定设置，避免上游不识别或返回非预期类型
            .header("Accept", DEFAULT_ACCEPT)
            .header("Content-Type", DEFAULT_CONTENT_TYPE);

        appendUpstreamHeaders(headersMap, builder);
        return builder.build();
    }

    private void appendUpstreamHeaders(Map<String, Object> headersMap, Request.Builder builder) {
        if (MapUtils.isEmpty(headersMap)) {
            return;
        }
        for (Map.Entry<String, Object> entry : headersMap.entrySet()) {
            String key = entry.getKey();
            Object valueObj = entry.getValue();
            if (StringUtil.isEmpty(key) || valueObj == null) {
                continue;
            }
            String lowerKey = key.toLowerCase(Locale.ROOT);

            // 这些头部通常由 HTTP 客户端/连接层管理，透传可能导致协议异常或与 OkHttp 行为冲突
            if ("host".equals(lowerKey) || "content-length".equals(lowerKey)) {
                continue;
            }

            // 由服务端统一设置，避免出现多个值导致上游解析异常
            if ("content-type".equals(lowerKey) || "accept".equals(lowerKey)) {
                continue;
            }

            builder.addHeader(key, valueObj.toString());
        }
    }

    private String safeHost(String url) {
        try {
            URI uri = URI.create(url);
            return uri.getHost();
        } catch (Exception e) {
            return "unknown";
        }
    }
}

