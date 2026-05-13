package com.iwhalecloud.byai.state.domain.langfuse.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.env.EnvConfigKey;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.interfaces.controller.langfuse.dto.LangfuseQueryDto;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;
import com.iwhalecloud.byai.state.common.util.OkHttpUtil;
import okhttp3.Headers;
import okhttp3.Response;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Langfuse服务类
 */
@Slf4j
@Service
public class LangfuseService {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    /**
     * 获取Langfuse配置
     */
    public String getLangfuseHost() {
        return ApplicationContextUtil.getEnvProperty(EnvConfigKey.LANGFUSE_HOST);
    }

    public String getLangfuseSecretKey() {
        return ApplicationContextUtil.getEnvProperty(EnvConfigKey.LANGFUSE_SECRET_KEY);
    }

    public String getLangfusePublicKey() {
        return ApplicationContextUtil.getEnvProperty(EnvConfigKey.LANGFUSE_PUBLIC_KEY);
    }

    public String getLangfuseEnv() {
        return ApplicationContextUtil.getEnvProperty(EnvConfigKey.LANGFUSE_ENV);
    }

    /**
     * 创建HTTP头
     */
    private Headers createHeaders() {
        // Langfuse API 使用 Basic Auth，用户名为 public key，密码为 secret key
        String publicKey = getLangfusePublicKey();
        String secretKey = getLangfuseSecretKey();
        String credentials = publicKey + ":" + secretKey;
        String encodedCredentials = java.util.Base64.getEncoder().encodeToString(credentials.getBytes());

        return new Headers.Builder().add("Content-Type", "application/json").add("Accept", "application/json")
            .add("Authorization", "Basic " + encodedCredentials).build();
    }

    /**
     * 处理HTTP响应
     */
    private Map<String, Object> processResponse(Response response, String operation) {
        String responseBody = null;
        try {
            if (response == null) {
                log.error("Response is null for operation: {}", operation);
                return createErrorResponse("Response is null", 500);
            }

            // 读取响应体（无论成功与否都记录，便于调试）
            responseBody = response.body() != null ? response.body().string() : null;

            if (response.isSuccessful()) {
                log.info("Successful {} - HTTP {}, Response: {}", operation, response.code(),
                    responseBody != null ? responseBody.substring(0, Math.min(200, responseBody.length())) + "..."
                        : "null");

                if (responseBody != null && !responseBody.trim().isEmpty()) {
                    return objectMapper.readValue(responseBody, new TypeReference<Map<String, Object>>() {
                    });
                }
                else {
                    return createErrorResponse("Empty response body", response.code());
                }
            }
            else {
                // 详细记录错误信息
                log.error("Failed {} - HTTP {}, URL: {}, Response: {}", operation, response.code(),
                    response.request().url(), responseBody);

                // 根据HTTP状态码提供更具体的错误信息
                String errorMsg = getErrorMessageByStatusCode(response.code(), operation);
                Map<String, Object> errorResponse = createErrorResponse(errorMsg, response.code());

                // 如果有响应体，尝试解析其中的错误信息
                if (responseBody != null && !responseBody.trim().isEmpty()) {
                    try {
                        Map<String, Object> errorDetails = objectMapper.readValue(responseBody,
                            new TypeReference<Map<String, Object>>() {
                            });
                        errorResponse.put("details", errorDetails);
                    }
                    catch (Exception e) {
                        errorResponse.put("rawResponse", responseBody);
                    }
                }

                return errorResponse;
            }
        }
        catch (Exception e) {
            log.error("Error processing response for {} - Response: {}", operation, responseBody, e);
            return createErrorResponse("Error processing response: " + e.getMessage(), 500);
        }
        finally {
            if (response != null) {
                response.close();
            }
        }
    }

    /**
     * 根据HTTP状态码获取错误信息
     */
    private String getErrorMessageByStatusCode(int statusCode, String operation) {
        switch (statusCode) {
            case 400:
                return "Bad request for " + operation + " - Check request parameters";
            case 401:
                return "Unauthorized for " + operation + " - Check API credentials";
            case 403:
                return "Forbidden for " + operation + " - Insufficient permissions";
            case 404:
                return "Not found for " + operation + " - Resource does not exist or incorrect endpoint";
            case 429:
                return "Rate limit exceeded for " + operation + " - Too many requests";
            case 500:
                return "Internal server error for " + operation + " - Server side issue";
            case 502:
                return "Bad gateway for " + operation + " - Server connection issue";
            case 503:
                return "Service unavailable for " + operation + " - Server temporarily unavailable";
            default:
                return "HTTP " + statusCode + " error for " + operation;
        }
    }

    /**
     * 查询Traces — 直接从本地消息记录构建
     */
    public Map<String, Object> queryTraces(LangfuseQueryDto queryDto) {
        try {
            if (StringUtils.isNotBlank(queryDto.getSessionId())) {
                return buildTracesFromLocalMessages(queryDto);
            }
            return createErrorResponse("sessionId is required", 400);
        }
        catch (Exception e) {
            log.error("Error querying traces", e);
            return createErrorResponse("Error querying traces: " + e.getMessage(), 500);
        }
    }

    /**
     * 从本地消息记录构建 Langfuse traces 格式的数据。
     * 将用户输入(usage=1)与紧随其后的系统回答(usage=2)配对为一个 trace。
     * 如果指定了 resMsgId，只返回该回复消息对应的一问一答。
     */
    private Map<String, Object> buildTracesFromLocalMessages(LangfuseQueryDto queryDto) {
        Long sessionId = Long.parseLong(queryDto.getSessionId());

        com.iwhalecloud.byai.state.domain.message.qo.MessageQo messageQo =
            new com.iwhalecloud.byai.state.domain.message.qo.MessageQo();
        messageQo.setSessionId(sessionId);
        messageQo.setTopK(queryDto.getLimit() != null ? queryDto.getLimit() * 2 : 100);

        List<ByaiMessageHotDto> messages = byaiMessageHotService.getMessages(messageQo);
        // 查询结果为 DESC，反转为时间正序
        java.util.Collections.reverse(messages);

        Long resMsgId = null;
        if (StringUtils.isNotBlank(queryDto.getResMsgId())) {
            try {
                resMsgId = Long.parseLong(queryDto.getResMsgId());
            } catch (NumberFormatException ignored) {
            }
        }

        List<Map<String, Object>> traceData = new ArrayList<>();
        for (int i = 0; i < messages.size(); i++) {
            ByaiMessageHotDto msg = messages.get(i);
            if (msg.getUsage() == null || msg.getUsage() != 1) {
                continue;
            }

            String input = msg.getMessageContent();
            String output = null;
            String startTimeMillis = msg.getCreateTimeMillis();
            String endTimeMillis = startTimeMillis;
            Long latencyMs = null;
            Long pairedResMsgId = null;

            if (i + 1 < messages.size()) {
                ByaiMessageHotDto nextMsg = messages.get(i + 1);
                if (nextMsg.getUsage() != null && nextMsg.getUsage() == 2) {
                    output = nextMsg.getMessageContent();
                    endTimeMillis = nextMsg.getCreateTimeMillis();
                    pairedResMsgId = nextMsg.getMessageId();
                    if (startTimeMillis != null && endTimeMillis != null) {
                        try {
                            latencyMs = Long.parseLong(endTimeMillis) - Long.parseLong(startTimeMillis);
                        }
                        catch (NumberFormatException ignored) {
                        }
                    }
                    i++;
                }
            }

            if (resMsgId != null && !resMsgId.equals(pairedResMsgId)) {
                continue;
            }

            Map<String, Object> trace = new HashMap<>();
            trace.put("id", String.valueOf(msg.getMessageId()));
            trace.put("name", "BaiYing Invocation");
            trace.put("sessionId", String.valueOf(msg.getSessionId()));
            trace.put("input", input);
            trace.put("output", output);
            trace.put("status", null);
            trace.put("userId", msg.getCreatorId() != null ? String.valueOf(msg.getCreatorId()) : null);
            trace.put("startTime", millisToIso(startTimeMillis));
            trace.put("endTime", millisToIso(endTimeMillis));
            trace.put("latency", latencyMs != null ? latencyMs / 1000.0 : null);
            traceData.add(trace);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("data", traceData);
        result.put("page", queryDto.getPage());
        result.put("limit", queryDto.getLimit());
        result.put("total", traceData.size());
        result.put("hasMore", false);
        return result;
    }

    private String millisToIso(String millis) {
        if (millis == null) {
            return null;
        }
        try {
            long ms = Long.parseLong(millis);
            return java.time.Instant.ofEpochMilli(ms)
                .atZone(java.time.ZoneId.systemDefault())
                .format(DateTimeFormatter.ISO_DATE_TIME);
        }
        catch (NumberFormatException e) {
            return millis;
        }
    }

    /**
     * 根据Trace ID查询Observations
     */
    public Map<String, Object> queryObservationsByTraceId(String traceId, LangfuseQueryDto queryDto) {
        try {
            // 输入验证
            if (traceId == null || traceId.trim().isEmpty()) {
                log.error("TraceId cannot be null or empty");
                return createErrorResponse("TraceId is required", 400);
            }

            // URL编码处理
            String encodedTraceId = java.net.URLEncoder.encode(traceId.trim(), "UTF-8");

            // 尝试方案1：使用 observations endpoint 加 traceId 参数（Langfuse 标准方式）
            Map<String, Object> result = tryObservationsWithTraceIdParam(encodedTraceId, queryDto);

            // 如果方案1失败且是404错误，尝试方案2：使用路径参数方式
            if (result.containsKey("error") && (Boolean) result.get("error")) {
                Integer statusCode = (Integer) result.get("statusCode");
                if (statusCode != null && statusCode == 404) {
                    log.warn("First attempt failed with 404, trying alternative endpoint for trace: {}", traceId);
                    result = tryObservationsWithPathParam(encodedTraceId, queryDto);

                    // 如果方案2也失败，尝试方案3：使用 v1 API 版本
                    if (result.containsKey("error") && (Boolean) result.get("error")) {
                        statusCode = (Integer) result.get("statusCode");
                        if (statusCode != null && statusCode == 404) {
                            log.warn("Second attempt also failed with 404, trying v1 API for trace: {}", traceId);
                            result = tryObservationsWithV1Api(encodedTraceId, queryDto);
                        }
                    }
                }
            }

            return result;
        }
        catch (Exception e) {
            log.error("Error querying observations for trace: {}", traceId, e);
            return createErrorResponse("Error querying observations: " + e.getMessage(), 500);
        }
    }

    /**
     * 方案1：使用 observations endpoint 加 traceId 参数
     */
    private Map<String, Object> tryObservationsWithTraceIdParam(String encodedTraceId, LangfuseQueryDto queryDto) {
        String url = getLangfuseHost() + "/api/public/observations";

        UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(url).queryParam("traceId", encodedTraceId)
            .queryParam("page", queryDto.getPage()).queryParam("limit", queryDto.getLimit())
            .queryParam("sortBy", queryDto.getSortBy()).queryParam("sortOrder", queryDto.getSortOrder());

        if (queryDto.getType() != null) {
            builder.queryParam("type", queryDto.getType());
        }
        if (queryDto.getStatus() != null) {
            builder.queryParam("status", queryDto.getStatus());
        }

        String finalUrl = builder.toUriString();
        log.info("Trying observations with traceId param - URL: {}", finalUrl);

        Response response = OkHttpUtil.getRequest(finalUrl, createHeaders());
        return processResponse(response, "query observations with traceId param");
    }

    /**
     * 方案2：使用路径参数方式
     */
    private Map<String, Object> tryObservationsWithPathParam(String encodedTraceId, LangfuseQueryDto queryDto) {
        String url = getLangfuseHost() + "/api/public/traces/" + encodedTraceId + "/observations";

        UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(url).queryParam("page", queryDto.getPage())
            .queryParam("limit", queryDto.getLimit()).queryParam("sortBy", queryDto.getSortBy())
            .queryParam("sortOrder", queryDto.getSortOrder());

        if (queryDto.getType() != null) {
            builder.queryParam("type", queryDto.getType());
        }
        if (queryDto.getStatus() != null) {
            builder.queryParam("status", queryDto.getStatus());
        }

        String finalUrl = builder.toUriString();
        log.info("Trying observations with path param - URL: {}", finalUrl);

        Response response = OkHttpUtil.getRequest(finalUrl, createHeaders());
        return processResponse(response, "query observations with path param");
    }

    /**
     * 方案3：使用 v1 API 版本
     */
    private Map<String, Object> tryObservationsWithV1Api(String encodedTraceId, LangfuseQueryDto queryDto) {
        String url = getLangfuseHost() + "/api/v1/traces/" + encodedTraceId + "/observations";

        UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(url).queryParam("page", queryDto.getPage())
            .queryParam("limit", queryDto.getLimit()).queryParam("sortBy", queryDto.getSortBy())
            .queryParam("sortOrder", queryDto.getSortOrder());

        if (queryDto.getType() != null) {
            builder.queryParam("type", queryDto.getType());
        }
        if (queryDto.getStatus() != null) {
            builder.queryParam("status", queryDto.getStatus());
        }

        String finalUrl = builder.toUriString();
        log.info("Trying observations with v1 API - URL: {}", finalUrl);

        Response response = OkHttpUtil.getRequest(finalUrl, createHeaders());
        return processResponse(response, "query observations with v1 API");
    }

    /**
     * 查询所有Observations
     */
    public Map<String, Object> queryObservations(LangfuseQueryDto queryDto) {
        try {
            String url = getLangfuseHost() + "/api/public/observations";

            UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(url).queryParam("page", queryDto.getPage())
                .queryParam("limit", queryDto.getLimit()).queryParam("sortBy", queryDto.getSortBy())
                .queryParam("sortOrder", queryDto.getSortOrder());

            if (queryDto.getTraceId() != null) {
                builder.queryParam("traceId", queryDto.getTraceId());
            }
            if (queryDto.getType() != null) {
                builder.queryParam("type", queryDto.getType());
            }
            if (queryDto.getStatus() != null) {
                builder.queryParam("status", queryDto.getStatus());
            }
            if (queryDto.getStartTime() != null) {
                builder.queryParam("startTime", queryDto.getStartTime().format(DateTimeFormatter.ISO_DATE_TIME));
            }
            if (queryDto.getEndTime() != null) {
                builder.queryParam("endTime", queryDto.getEndTime().format(DateTimeFormatter.ISO_DATE_TIME));
            }

            Response response = OkHttpUtil.getRequest(builder.toUriString(), createHeaders());
            return processResponse(response, "query observations");
        }
        catch (Exception e) {
            log.error("Error querying observations", e);
            return createErrorResponse("Error querying observations: " + e.getMessage(), 500);
        }
    }

    /**
     * 根据ID获取Trace详情
     */
    public Map<String, Object> getTraceById(String traceId) {
        try {
            String url = getLangfuseHost() + "/api/public/traces/" + traceId;

            Response response = OkHttpUtil.getRequest(url, createHeaders());
            return processResponse(response, "get trace " + traceId);
        }
        catch (Exception e) {
            log.error("Error getting trace: {}", traceId, e);
            return createErrorResponse("Error getting trace: " + e.getMessage(), 500);
        }
    }

    /**
     * 根据ID获取Observation详情
     */
    public Map<String, Object> getObservationById(String observationId) {
        try {
            String url = getLangfuseHost() + "/api/public/observations/" + observationId;

            Response response = OkHttpUtil.getRequest(url, createHeaders());
            return processResponse(response, "get observation " + observationId);
        }
        catch (Exception e) {
            log.error("Error getting observation: {}", observationId, e);
            return createErrorResponse("Error getting observation: " + e.getMessage(), 500);
        }
    }

    /**
     * 根据sessionId查询Traces
     */
    public Map<String, Object> queryTracesBySessionId(String sessionId, LangfuseQueryDto queryDto) {
        try {
            if (queryDto == null) {
                queryDto = new LangfuseQueryDto();
            }
            queryDto.setSessionId(sessionId);

            return queryTraces(queryDto);
        }
        catch (Exception e) {
            log.error("Error querying traces by sessionId: {}", sessionId, e);
            return createErrorResponse("Error querying traces by sessionId: " + e.getMessage(), 500);
        }
    }

    /**
     * 根据sessionId查询会话基本信息（步骤1） 返回会话的基本信息，包括总耗时、用户ID、trace数量等
     */
    public Map<String, Object> getSessionBasicInfo(String sessionId, LangfuseQueryDto queryDto) {
        try {
            // 查询sessionId对应的Traces来获取会话基本信息
            Map<String, Object> tracesResult = queryTracesBySessionId(sessionId, queryDto);
            if (tracesResult.containsKey("error") && (Boolean) tracesResult.get("error")) {
                return tracesResult;
            }

            List<Map<String, Object>> traces = new ArrayList<>();
            if (tracesResult.containsKey("data")) {
                traces = (List<Map<String, Object>>) tracesResult.get("data");
            }

            if (traces.isEmpty()) {
                return createErrorResponse("No traces found for session: " + sessionId, 404);
            }

            // 计算会话基本信息
            Map<String, Object> sessionInfo = new HashMap<>();
            sessionInfo.put("sessionId", sessionId);
            sessionInfo.put("totalTraces", traces.size());

            // 计算会话总耗时（从第一个trace开始到最后一个trace结束）
            Map<String, Object> firstTrace = traces.get(0);
            Map<String, Object> lastTrace = traces.get(traces.size() - 1);

            String sessionStartTime = (String) firstTrace.get("startTime");
            String sessionEndTime = (String) lastTrace.get("endTime");

            if (sessionStartTime != null && sessionEndTime != null) {
                Long sessionDuration = calculateDurationFromTimes(sessionStartTime, sessionEndTime);
                sessionInfo.put("sessionDuration", sessionDuration);
                sessionInfo.put("startTime", sessionStartTime);
                sessionInfo.put("endTime", sessionEndTime);
            }

            // 获取用户ID（从第一个trace获取）
            String userId = (String) firstTrace.get("userId");
            sessionInfo.put("userId", userId);

            // 统计成功和失败的trace数量
            int successCount = 0;
            int errorCount = 0;
            long totalCost = 0;

            for (Map<String, Object> trace : traces) {
                String status = (String) trace.get("status");
                if ("SUCCESS".equals(status)) {
                    successCount++;
                }
                else if ("ERROR".equals(status) || "FAILED".equals(status)) {
                    errorCount++;
                }

                // 计算成本（如果有的话）
                if (trace.containsKey("totalCost")) {
                    Object cost = trace.get("totalCost");
                    if (cost instanceof Number) {
                        totalCost += ((Number) cost).longValue();
                    }
                }
            }

            sessionInfo.put("successTraces", successCount);
            sessionInfo.put("errorTraces", errorCount);
            sessionInfo.put("successRate", traces.size() > 0 ? (double) successCount / traces.size() : 0.0);
            sessionInfo.put("totalCost", totalCost);

            return sessionInfo;
        }
        catch (Exception e) {
            log.error("Error getting session basic info for sessionId: {}", sessionId, e);
            return createErrorResponse("Error getting session basic info: " + e.getMessage(), 500);
        }
    }

    /**
     * 根据sessionId查询会话下的traces基本信息（步骤2） 返回每个trace的基本信息：耗时、input摘要、output摘要
     */
    public Map<String, Object> getSessionTracesBasicInfo(String sessionId, LangfuseQueryDto queryDto) {
        try {
            if (queryDto == null) {
                queryDto = new LangfuseQueryDto();
                queryDto.setPage(1);
                queryDto.setLimit(50);
                queryDto.setSortBy("startTime");
                queryDto.setSortOrder("asc");
            }

            Map<String, Object> tracesResult = queryTracesBySessionId(sessionId, queryDto);
            if (tracesResult.containsKey("error") && (Boolean) tracesResult.get("error")) {
                return tracesResult;
            }

            List<Map<String, Object>> traces = new ArrayList<>();
            if (tracesResult.containsKey("data")) {
                traces = (List<Map<String, Object>>) tracesResult.get("data");
            }

            // 构建traces基本信息列表
            List<Map<String, Object>> tracesBasicInfo = new ArrayList<>();

            for (Map<String, Object> trace : traces) {
                Map<String, Object> traceBasicInfo = new HashMap<>();

                // 基本信息
                traceBasicInfo.put("id", trace.get("id"));
                traceBasicInfo.put("name", trace.get("name"));
                traceBasicInfo.put("status", trace.get("status"));
                traceBasicInfo.put("startTime", trace.get("startTime"));
                traceBasicInfo.put("endTime", trace.get("endTime"));
                traceBasicInfo.put("userId", trace.get("userId"));
                traceBasicInfo.put("input", trace.get("input"));
                traceBasicInfo.put("output", trace.get("output"));
                traceBasicInfo.put("latency", trace.get("latency"));
                tracesBasicInfo.add(traceBasicInfo);
            }

            Map<String, Object> result = new HashMap<>();
            result.put("sessionId", sessionId);
            result.put("traces", tracesBasicInfo);
            result.put("meta", buildMetaInfo(tracesResult));

            return result;
        }
        catch (Exception e) {
            log.error("Error getting session traces basic info for sessionId: {}", sessionId, e);
            return createErrorResponse("Error getting session traces basic info: " + e.getMessage(), 500);
        }
    }

    /**
     * 根据traceId查询时间线基本信息（步骤3） 返回trace下的observations层级结构，只显示基本信息
     */
    public Map<String, Object> getTraceTimelineBasicInfo(String traceId, LangfuseQueryDto queryDto) {
        try {
            // 获取trace完整信息（包含observations）
            Map<String, Object> traceResult = getTraceById(traceId);
            if (traceResult.containsKey("error") && (Boolean) traceResult.get("error")) {
                // Langfuse 无此 trace，尝试从本地消息构建
                return buildLocalTraceTimeline(traceId);
            }

            // 从trace结果中提取observations
            List<Map<String, Object>> observations = new ArrayList<>();
            if (traceResult.containsKey("observations")) {
                observations = (List<Map<String, Object>>) traceResult.get("observations");
            }

            // 构建时间线基本信息
            List<Map<String, Object>> timelineItems = new ArrayList<>();

            if (!observations.isEmpty()) {
                // 按父子关系分组
                Map<String, List<Map<String, Object>>> observationsByParent = new HashMap<>();
                List<Map<String, Object>> rootObservations = new ArrayList<>();

                for (Map<String, Object> obs : observations) {
                    String parentId = MapParamUtil.getStringValue(obs, "parentObservationId");
                    // 移除metadata以减少数据量
                    obs.remove("metadata");

                    if (StringUtils.isBlank(parentId)) {
                        // 没有父级，是根节点
                        rootObservations.add(obs);
                    }
                    else {
                        // 有父级，添加到对应父级的子节点列表
                        observationsByParent.computeIfAbsent(parentId, k -> new ArrayList<>()).add(obs);
                    }
                }

                // 构建层级结构（只包含基本信息）
                timelineItems = buildTimelineBasicInfo(rootObservations, observationsByParent);
            }

            // 构建trace基本信息（移除observations，因为已经单独处理）
            Map<String, Object> traceBasicInfo = new HashMap<>(traceResult);
            traceBasicInfo.remove("observations");
            traceBasicInfo.remove("metadata");

            Map<String, Object> result = new HashMap<>();
            result.put("traceId", traceId);
            result.put("traceInfo", traceBasicInfo);
            result.put("timeline", timelineItems);

            return result;
        }
        catch (Exception e) {
            log.warn("Langfuse unavailable for traceId: {}, falling back to local", traceId, e);
            return buildLocalTraceTimeline(traceId);
        }
    }

    /**
     * 从本地消息构建 trace timeline（当 Langfuse 无此 traceId 时回退）
     */
    private Map<String, Object> buildLocalTraceTimeline(String traceId) {
        try {
            Long messageId = Long.parseLong(traceId);
            ByaiMessageHotDto msg = byaiMessageHotService.findById(messageId);
            if (msg == null) {
                return createErrorResponse("Trace not found: " + traceId, 404);
            }

            String input = msg.getMessageContent();
            String output = null;
            String startTimeIso = millisToIso(msg.getCreateTimeMillis());
            String endTimeIso = startTimeIso;
            Double latencySec = null;

            com.iwhalecloud.byai.state.domain.message.qo.MessageQo messageQo =
                new com.iwhalecloud.byai.state.domain.message.qo.MessageQo();
            messageQo.setSessionId(msg.getSessionId());
            messageQo.setTopK(100);
            List<ByaiMessageHotDto> messages = byaiMessageHotService.getMessages(messageQo);
            java.util.Collections.reverse(messages);
            for (int i = 0; i < messages.size() - 1; i++) {
                if (messages.get(i).getMessageId().equals(messageId)
                    && messages.get(i + 1).getUsage() != null
                    && messages.get(i + 1).getUsage() == 2) {
                    ByaiMessageHotDto reply = messages.get(i + 1);
                    output = reply.getMessageContent();
                    endTimeIso = millisToIso(reply.getCreateTimeMillis());
                    if (msg.getCreateTimeMillis() != null && reply.getCreateTimeMillis() != null) {
                        try {
                            long ms = Long.parseLong(reply.getCreateTimeMillis()) - Long.parseLong(msg.getCreateTimeMillis());
                            latencySec = ms / 1000.0;
                        }
                        catch (NumberFormatException ignored) {
                        }
                    }
                    break;
                }
            }

            Map<String, Object> traceInfo = new HashMap<>();
            traceInfo.put("id", traceId);
            traceInfo.put("name", "BaiYing Invocation");
            traceInfo.put("input", input);
            traceInfo.put("output", output);
            traceInfo.put("startTime", startTimeIso);
            traceInfo.put("endTime", endTimeIso);
            traceInfo.put("latency", latencySec);
            traceInfo.put("userId", msg.getCreatorId() != null ? String.valueOf(msg.getCreatorId()) : null);

            Map<String, Object> timelineNode = new HashMap<>();
            timelineNode.put("id", traceId);
            timelineNode.put("type", "SPAN");
            timelineNode.put("name", "BaiYing Invocation");
            timelineNode.put("input", input);
            timelineNode.put("output", output);
            timelineNode.put("startTime", startTimeIso);
            timelineNode.put("endTime", endTimeIso);
            timelineNode.put("latency", latencySec != null ? (long) (latencySec * 1000) : null);
            timelineNode.put("parentId", null);

            List<Map<String, Object>> timeline = new ArrayList<>();
            timeline.add(timelineNode);

            Map<String, Object> result = new HashMap<>();
            result.put("traceId", traceId);
            result.put("traceInfo", traceInfo);
            result.put("timeline", timeline);
            return result;
        }
        catch (NumberFormatException e) {
            return createErrorResponse("Invalid traceId: " + traceId, 400);
        }
    }

    public Map<String, Object> getNodeFullDetails(String nodeId, String nodeType) {
        try {
            Map<String, Object> result = new HashMap<>();

            if ("trace".equals(nodeType)) {
                // 获取trace完整信息
                result = getTraceById(nodeId);
            }
            else if ("observation".equals(nodeType)) {
                // 获取observation完整信息
                result = getObservationById(nodeId);
            }
            else {
                return createErrorResponse("Unsupported node type: " + nodeType, 400);
            }

            return result;
        }
        catch (Exception e) {
            log.error("Error getting node full details for nodeId: {}, nodeType: {}", nodeId, nodeType, e);
            return createErrorResponse("Error getting node full details: " + e.getMessage(), 500);
        }
    }

    /**
     * 根据sessionId查询完整的会话流程（兼容旧接口） 现在返回分步骤的数据结构
     */
    public Map<String, Object> querySessionFlowBySessionId(String sessionId, LangfuseQueryDto queryDto) {
        try {
            // 1. 获取会话基本信息
            Map<String, Object> sessionInfo = getSessionBasicInfo(sessionId, queryDto);
            if (sessionInfo.containsKey("error") && (Boolean) sessionInfo.get("error")) {
                return sessionInfo;
            }

            // 2. 获取traces基本信息
            Map<String, Object> tracesInfo = getSessionTracesBasicInfo(sessionId, queryDto);
            if (tracesInfo.containsKey("error") && (Boolean) tracesInfo.get("error")) {
                return tracesInfo;
            }

            // 3. 构建返回结果
            Map<String, Object> result = new HashMap<>();
            result.put("sessionInfo", sessionInfo);
            result.put("tracesInfo", tracesInfo);
            result.put("sessionId", sessionId);

            return result;
        }
        catch (Exception e) {
            log.error("Error querying session flow by sessionId: {}", sessionId, e);
            return createErrorResponse("Error querying session flow by sessionId: " + e.getMessage(), 500);
        }
    }

    /**
     * 构建时间线项的通用结构
     */
    private Map<String, Object> buildTimelineItem(Map<String, Object> item, String itemType, String parentId) {
        Map<String, Object> timelineItem = new HashMap<>();

        timelineItem.put("id", item.get("id"));
        timelineItem.put("type", itemType);
        timelineItem.put("name", item.get("name"));
        timelineItem.put("status", item.get("status"));
        timelineItem.put("startTime", item.get("startTime"));
        timelineItem.put("endTime", item.get("endTime"));
        timelineItem.put("parentId", parentId);
        timelineItem.put("latency", item.get("latency"));

        // 添加输入输出信息（如果存在）
        if (item.containsKey("input")) {
            timelineItem.put("input", item.get("input"));
        }
        if (item.containsKey("output")) {
            timelineItem.put("output", item.get("output"));
        }

        // 添加模型信息（如果是LLM调用）
        if (item.containsKey("model")) {
            timelineItem.put("model", item.get("model"));
        }

        // 添加使用量信息（如果存在）
        if (item.containsKey("usage")) {
            timelineItem.put("usage", item.get("usage"));
        }

        // 添加元数据（如果存在）
        if (item.containsKey("metadata")) {
            timelineItem.put("metadata", item.get("metadata"));
        }

        // 添加标签（如果存在）
        if (item.containsKey("tags")) {
            timelineItem.put("tags", item.get("tags"));
        }

        // 添加用户信息（如果存在）
        if (item.containsKey("userId")) {
            timelineItem.put("userId", item.get("userId"));
        }

        return timelineItem;
    }

    /**
     * 构建观察项的层级结构
     */
    private List<Map<String, Object>> buildObservationHierarchy(List<Map<String, Object>> rootObservations,
        Map<String, List<Map<String, Object>>> observationsByParent) {

        List<Map<String, Object>> result = new ArrayList<>();

        for (Map<String, Object> obs : rootObservations) {
            String obsType = (String) obs.get("type");
            if (obsType == null)
                obsType = "observation";

            Map<String, Object> obsItem = buildTimelineItem(obs, obsType, null);

            // 递归构建子项
            String obsId = (String) obs.get("id");
            if (observationsByParent.containsKey(obsId)) {
                List<Map<String, Object>> children = buildObservationHierarchy(observationsByParent.get(obsId),
                    observationsByParent);
                obsItem.put("children", children);
            }

            result.add(obsItem);
        }

        // 按开始时间排序
        result.sort((a, b) -> {
            String timeA = (String) a.get("startTime");
            String timeB = (String) b.get("startTime");
            if (timeA == null || timeB == null)
                return 0;
            return timeA.compareTo(timeB);
        });

        return result;
    }

    /**
     * 构建时间线基本信息（只包含基本信息，不包含完整输入输出）
     */
    private List<Map<String, Object>> buildTimelineBasicInfo(List<Map<String, Object>> rootObservations,
        Map<String, List<Map<String, Object>>> observationsByParent) {

        List<Map<String, Object>> result = new ArrayList<>();

        for (Map<String, Object> obs : rootObservations) {
            String obsType = (String) obs.get("type");
            if (obsType == null)
                obsType = "observation";

            Map<String, Object> obsItem = buildTimelineBasicItem(obs, obsType, null);

            // 递归构建子项
            String obsId = (String) obs.get("id");
            if (observationsByParent.containsKey(obsId)) {
                List<Map<String, Object>> children = buildTimelineBasicInfo(observationsByParent.get(obsId),
                    observationsByParent);
                obsItem.put("children", children);
            }

            result.add(obsItem);
        }

        // 按开始时间排序
        result.sort((a, b) -> {
            String timeA = (String) a.get("startTime");
            String timeB = (String) b.get("startTime");
            if (timeA == null || timeB == null)
                return 0;
            return timeA.compareTo(timeB);
        });

        return result;
    }

    /**
     * 构建时间线基本信息项（只包含基本信息）
     */
    private Map<String, Object> buildTimelineBasicItem(Map<String, Object> item, String itemType, String parentId) {
        Map<String, Object> timelineItem = new HashMap<>();

        timelineItem.put("id", item.get("id"));
        timelineItem.put("type", itemType);
        timelineItem.put("name", item.get("name"));
        timelineItem.put("status", item.get("status"));
        timelineItem.put("startTime", item.get("startTime"));
        timelineItem.put("endTime", item.get("endTime"));
        timelineItem.put("parentId", parentId);
        timelineItem.put("latency", item.get("latency"));
        timelineItem.put("input", item.get("input"));
        timelineItem.put("output", item.get("output"));

        // 添加模型信息（如果是LLM调用）
        if (item.containsKey("model")) {
            timelineItem.put("model", item.get("model"));
        }

        // 添加使用量信息（如果存在）
        if (item.containsKey("usage")) {
            timelineItem.put("usage", item.get("usage"));
        }

        // 添加标签（如果存在）
        if (item.containsKey("tags")) {
            timelineItem.put("tags", item.get("tags"));
        }

        return timelineItem;
    }

    /**
     * 根据时间字符串计算持续时间，兼容毫秒时间戳和 ISO 日期时间格式
     */
    private Long calculateDurationFromTimes(String startTimeStr, String endTimeStr) {
        try {
            if (startTimeStr == null || endTimeStr == null) {
                return null;
            }

            long startMillis = parseToEpochMillis(startTimeStr);
            long endMillis = parseToEpochMillis(endTimeStr);

            return Math.abs(endMillis - startMillis);
        }
        catch (Exception e) {
            log.warn("Error calculating duration from times: {} to {}", startTimeStr, endTimeStr, e);
            return null;
        }
    }

    private long parseToEpochMillis(String timeStr) {
        try {
            return Long.parseLong(timeStr);
        }
        catch (NumberFormatException e) {
            String normalized = timeStr.replace("Z", "");
            LocalDateTime ldt = LocalDateTime.parse(normalized);
            return ldt.atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();
        }
    }

    /**
     * 计算延迟时间（毫秒）
     */
    private Long calculateDuration(Map<String, Object> item) {
        try {
            String startTimeStr = (String) item.get("startTime");
            String endTimeStr = (String) item.get("endTime");

            return calculateDurationFromTimes(startTimeStr, endTimeStr);
        }
        catch (Exception e) {
            log.warn("Error calculating latency for item: {}", item.get("id"), e);
            return null;
        }
    }

    /**
     * 构建元信息
     */
    private Map<String, Object> buildMetaInfo(Map<String, Object> tracesResult) {
        Map<String, Object> meta = new HashMap<>();
        meta.put("page", tracesResult.get("page"));
        meta.put("limit", tracesResult.get("limit"));
        meta.put("total", tracesResult.get("total"));
        meta.put("hasMore", tracesResult.get("hasMore"));
        return meta;
    }

    /**
     * 根据sessionId查询会话统计信息
     */
    public Map<String, Object> getSessionStatisticsBySessionId(String sessionId) {
        try {
            Map<String, Object> result = new HashMap<>();

            // 查询sessionId对应的Traces
            LangfuseQueryDto queryDto = new LangfuseQueryDto();
            queryDto.setPage(1);
            queryDto.setLimit(1000); // 获取所有数据用于统计

            Map<String, Object> tracesResult = queryTracesBySessionId(sessionId, queryDto);
            if (tracesResult.containsKey("error") && (Boolean) tracesResult.get("error")) {
                return tracesResult;
            }

            List<Map<String, Object>> traces = new ArrayList<>();
            if (tracesResult.containsKey("data")) {
                traces = (List<Map<String, Object>>) tracesResult.get("data");
            }

            // 统计信息
            int totalTraces = traces.size();
            int successTraces = 0;
            int failedTraces = 0;
            long totalLatency = 0;
            List<String> traceIds = new ArrayList<>();

            for (Map<String, Object> trace : traces) {
                String status = (String) trace.get("status");
                if ("SUCCESS".equals(status)) {
                    successTraces++;
                }
                else if ("ERROR".equals(status) || "FAILED".equals(status)) {
                    failedTraces++;
                }

                // 计算延迟时间
                if (trace.containsKey("startTime") && trace.containsKey("endTime")) {
                    Long duration = calculateDurationFromTimes(
                        (String) trace.get("startTime"), (String) trace.get("endTime"));
                    if (duration != null) {
                        totalLatency += duration;
                    }
                }

                traceIds.add((String) trace.get("id"));
            }

            result.put("sessionId", sessionId);
            result.put("totalTraces", totalTraces);
            result.put("successTraces", successTraces);
            result.put("failedTraces", failedTraces);
            result.put("successRate", totalTraces > 0 ? (double) successTraces / totalTraces : 0.0);
            result.put("averageLatency", totalTraces > 0 ? totalLatency / totalTraces : 0);
            result.put("totalLatency", totalLatency);
            result.put("traceIds", traceIds);

            return result;
        }
        catch (Exception e) {
            log.error("Error getting session statistics by sessionId: {}", sessionId, e);
            return createErrorResponse("Error getting session statistics by sessionId: " + e.getMessage(), 500);
        }
    }

    /**
     * 根据sessionId查询最近的会话记录
     */
    public Map<String, Object> getRecentSessionsBySessionId(String sessionId, int limit) {
        try {
            LangfuseQueryDto queryDto = new LangfuseQueryDto();
            queryDto.setPage(1);
            queryDto.setLimit(limit);
            queryDto.setSortBy("startTime");
            queryDto.setSortOrder("desc");

            return queryTracesBySessionId(sessionId, queryDto);
        }
        catch (Exception e) {
            log.error("Error getting recent sessions by sessionId: {}", sessionId, e);
            return createErrorResponse("Error getting recent sessions by sessionId: " + e.getMessage(), 500);
        }
    }

    /**
     * 创建错误响应
     */
    private Map<String, Object> createErrorResponse(String message, int statusCode) {
        Map<String, Object> errorResponse = new HashMap<>();
        errorResponse.put("error", true);
        errorResponse.put("message", message);
        errorResponse.put("statusCode", statusCode);
        return errorResponse;
    }

    /**
     * 示例：如何将observations数据转换为时间线形式 这个方法展示了基于你提供的API响应数据的时间线构建逻辑
     */
    public Map<String, Object> buildTimelineFromObservationsExample() {
        // 基于你提供的API响应数据构建示例
        Map<String, Object> result = new HashMap<>();

        // 模拟从getTraceById返回的数据结构
        Map<String, Object> traceData = new HashMap<>();
        traceData.put("id", "d694222d0832257adcc4b0fe8a4842ac");
        traceData.put("name", "BaiYing Invocation");
        traceData.put("input", "哈哈");
        traceData.put("output", "哈哈，看来您心情不错！如果您有任何考勤相关的问题，尽管问我哦，我会尽力为您解答。😊");
        traceData.put("latency", 9.265);

        // 模拟observations数据
        List<Map<String, Object>> observations = new ArrayList<>();

        // 根节点 observation
        Map<String, Object> rootObs = new HashMap<>();
        rootObs.put("id", "405506aa1c59aa26");
        rootObs.put("type", "SPAN");
        rootObs.put("name", "BaiYing Invocation");
        rootObs.put("parentObservationId", null);
        rootObs.put("startTime", "2025-09-01T03:27:08.502Z");
        rootObs.put("endTime", "2025-09-01T03:27:17.767Z");
        rootObs.put("latency", 9265);
        rootObs.put("input", "哈哈");
        rootObs.put("output", "哈哈，看来您心情不错！如果您有任何考勤相关的问题，尽管问我哦，我会尽力为您解答。😊");
        observations.add(rootObs);

        // 子节点 observation
        Map<String, Object> childObs1 = new HashMap<>();
        childObs1.put("id", "fb1ac6be32b8c640");
        childObs1.put("type", "SPAN");
        childObs1.put("name", "agent_run [digital_employee_agent]");
        childObs1.put("parentObservationId", "405506aa1c59aa26");
        childObs1.put("startTime", "2025-09-01T03:27:13.005Z");
        childObs1.put("endTime", "2025-09-01T03:27:17.766Z");
        childObs1.put("latency", 4761);
        childObs1.put("input", null);
        childObs1.put("output", null);
        observations.add(childObs1);

        // 孙节点 observation
        Map<String, Object> childObs2 = new HashMap<>();
        childObs2.put("id", "d698e3df2bcdb6e7");
        childObs2.put("type", "GENERATION");
        childObs2.put("name", "call_llm");
        childObs2.put("parentObservationId", "fb1ac6be32b8c640");
        childObs2.put("startTime", "2025-09-01T03:27:13.007Z");
        childObs2.put("endTime", "2025-09-01T03:27:17.765Z");
        childObs2.put("latency", 4758);
        childObs2.put("model", "openai/Qwen/Qwen3-235B-A22B");
        childObs2.put("input", "复杂的LLM输入...");
        childObs2.put("output", "LLM输出结果...");
        observations.add(childObs2);

        // 构建时间线
        List<Map<String, Object>> timeline = buildTimelineFromObservations(observations);

        result.put("traceInfo", traceData);
        result.put("timeline", timeline);

        return result;
    }

    /**
     * 从observations数组构建时间线结构
     */
    private List<Map<String, Object>> buildTimelineFromObservations(List<Map<String, Object>> observations) {
        // 按父子关系分组
        Map<String, List<Map<String, Object>>> observationsByParent = new HashMap<>();
        List<Map<String, Object>> rootObservations = new ArrayList<>();

        for (Map<String, Object> obs : observations) {
            String parentId = MapParamUtil.getStringValue(obs, "parentObservationId");

            if (StringUtils.isBlank(parentId)) {
                // 没有父级，是根节点
                rootObservations.add(obs);
            }
            else {
                // 有父级，添加到对应父级的子节点列表
                observationsByParent.computeIfAbsent(parentId, k -> new ArrayList<>()).add(obs);
            }
        }

        // 构建层级结构
        return buildTimelineBasicInfo(rootObservations, observationsByParent);
    }
}
