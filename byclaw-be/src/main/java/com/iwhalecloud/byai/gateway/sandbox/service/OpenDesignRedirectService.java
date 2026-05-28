package com.iwhalecloud.byai.gateway.sandbox.service;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.iwhalecloud.byai.common.log.util.RequestContextUtil;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenDesignClient;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignConversationRecord;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignConversationResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignConversationsResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignCreateProjectResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignProjectResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.opendesign.OpenDesignRunCreateResponse;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignProjectContext;
import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignQueryParams;
import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignRedirectResult;
import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignRequestEnvironment;
import com.iwhalecloud.byai.gateway.sandbox.model.opendesign.OpenDesignRunContext;
import com.iwhalecloud.byai.gateway.sandbox.service.exception.OpenDesignAdapterException;

/**
 * Open Design 跳转编排服务。
 * 负责把外部适配参数归一化成 daemon 可识别的调用序列，并最终产出 Web 跳转地址。
 */
@Service
public class OpenDesignRedirectService {

    private static final Logger LOGGER = LoggerFactory.getLogger(OpenDesignRedirectService.class);
    private static final ObjectMapper OBJECT_MAPPER = createObjectMapper();
    private static final String OPEN_DESIGN_ROUTE_PREFIX = "/openDesign";

    private final SandboxProperties sandboxProperties;
    private final OpenDesignClient openDesignClient;
    private final OpenDesignEndpointResolver openDesignEndpointResolver;

    @Autowired
    public OpenDesignRedirectService(SandboxProperties sandboxProperties, OpenDesignClient openDesignClient,
                                     OpenDesignEndpointResolver openDesignEndpointResolver) {
        this.sandboxProperties = sandboxProperties;
        this.openDesignClient = openDesignClient;
        this.openDesignEndpointResolver = openDesignEndpointResolver;
    }

    public OpenDesignRedirectService(SandboxProperties sandboxProperties, OpenDesignClient openDesignClient) {
        this(sandboxProperties, openDesignClient, null);
    }

    public OpenDesignRedirectResult prepareRedirect(Map<String, Object> rawParams) {
        OpenDesignQueryParams queryParams = normalizeQueryParams(rawParams);
        OpenDesignRequestEnvironment env = buildRequestEnvironment(queryParams);
        String requestId = String.valueOf(RequestContextUtil.getRequestIdOrGenerate());

        validateBaseConfig(queryParams, env);
        assertHealthy(env, requestId);

        if (!hasProjectId(queryParams)) {
            // 没有 sessionId 时，行为退化为“只打开 Open Design 首页”。
            return new OpenDesignRedirectResult(buildHomeUrl(env.getRedirectRoutePrefix()));
        }

        validateQueryParams(queryParams);
        OpenDesignProjectContext context = resolveProjectContext(env, queryParams, requestId);
        if (context.isProjectExists() || !hasPrompt(queryParams)) {
            // 已有项目或无 prompt 时，只做跳转，不创建消息和 run。
            return new OpenDesignRedirectResult(buildProjectUrl(env.getRedirectRoutePrefix(), context.getProjectId(),
                context.getConversationId()));
        }

        validateRunEnvironment(env);

        OpenDesignRunContext runContext = buildRunContext(queryParams);

        syncConversationState(env, queryParams, context, runContext, requestId);

        return new OpenDesignRedirectResult(buildProjectUrl(env.getRedirectRoutePrefix(), context.getProjectId(),
            context.getConversationId()));
    }

    private OpenDesignQueryParams normalizeQueryParams(Map<String, Object> rawParams) {
        Map<String, Object> params = rawParams != null ? rawParams : Collections.emptyMap();
        // 兼容源入口的多套 prompt 字段，统一收口后续编排逻辑。
        String prompt = firstText(params.get("prompt"), params.get("message"), params.get("chatInputValue"),
            params.get("currentPrompt"), params.get("userGoal"));

        OpenDesignQueryParams queryParams = new OpenDesignQueryParams();
        queryParams.setProjectId(trimToEmpty(params.get("sessionId")));
        queryParams.setConversationId(trimToEmpty(params.get("conversationId")));
        queryParams.setUserCode(trimToEmpty(params.get("userCode")));
        queryParams.setDaemonBaseUrl(trimTrailingSlash(firstText(params.get("daemonBaseUrl"),
            params.get("openDesignDaemonBaseUrl"), params.get("open-design-daemon-base-url"),
            params.get("OPEN_DESIGN_DAEMON_BASE_URL"))));
        queryParams.setWebBaseUrl(trimTrailingSlash(firstText(params.get("webBaseUrl"),
            params.get("openDesignWebBaseUrl"), params.get("open-design-web-base-url"),
            params.get("OPEN_DESIGN_WEB_BASE_URL"))));
        queryParams.setAgentId(firstText(params.get("agentId"), params.get("openDesignAgentId"),
            params.get("open-design-agent-id"), params.get("OPEN_DESIGN_AGENT_ID"), params.get("agentd")));
        queryParams.setPrompt(prompt);
        queryParams.setChatInputValue(prompt);
        queryParams.setCurrentPrompt(prompt);
        queryParams.setUserGoal(prompt);
        queryParams.setProjectName(firstText(params.get("projectName"), titleFromPrompt(prompt)));
        queryParams.setConversationTitle(firstText(params.get("conversationTitle"), titleFromPrompt(prompt)));
        queryParams.setSkillId(normalizeOptionalString(firstText(params.get("skillId"), params.get("defaultSkillId"),
            params.get("openDesignDefaultSkillId"), params.get("open-design-default-skill-id"),
            params.get("OPEN_DESIGN_DEFAULT_SKILL_ID"))));
        queryParams.setDesignSystemId(normalizeOptionalString(firstText(params.get("designSystemId"),
            params.get("defaultDesignSystemId"), params.get("openDesignDefaultDesignSystemId"),
            params.get("open-design-default-design-system-id"),
            params.get("OPEN_DESIGN_DEFAULT_DESIGN_SYSTEM_ID"))));
        queryParams.setClientRequestId(firstText(params.get("clientRequestId"), params.get("requestId")));
        queryParams.setUserMessageId(normalizeOptionalString(params.get("userMessageId")));
        queryParams.setAssistantMessageId(normalizeOptionalString(params.get("assistantMessageId")));
        queryParams.setAttachments(parseStringList(params.get("attachments")));
        queryParams.setCommentAttachments(parseStringList(params.get("commentAttachments")));
        queryParams.setSkillIds(parseStringList(params.get("skillIds")));
        return queryParams;
    }

    private OpenDesignRequestEnvironment buildRequestEnvironment(OpenDesignQueryParams queryParams) {
        if (openDesignEndpointResolver != null) {
            OpenDesignRequestEnvironment env = openDesignEndpointResolver.resolve();
            env.setAgentId(StringUtils.defaultIfBlank(queryParams.getAgentId(), env.getAgentId()));
            return env;
        }
        OpenDesignRequestEnvironment env = new OpenDesignRequestEnvironment();
        env.setDaemonBaseUrl(queryParams.getDaemonBaseUrl());
        env.setRedirectRoutePrefix(OPEN_DESIGN_ROUTE_PREFIX);
        env.setAgentId(StringUtils.defaultIfBlank(queryParams.getAgentId(),
            sandboxProperties.getOpenDesignAgentId()));
        env.setDefaultSkillId(sandboxProperties.getOpenDesignDefaultSkillId());
        env.setDefaultDesignSystemId(sandboxProperties.getOpenDesignDefaultDesignSystemId());
        return env;
    }

    private void validateBaseConfig(OpenDesignQueryParams queryParams, OpenDesignRequestEnvironment env) {
        if (StringUtils.isBlank(queryParams.getDaemonBaseUrl()) && StringUtils.isBlank(env.getDaemonBaseUrl())) {
            throw new OpenDesignAdapterException(400, "Open Design endpoint is required");
        }
    }

    private void validateRunEnvironment(OpenDesignRequestEnvironment env) {
        if (StringUtils.isBlank(env.getAgentId())) {
            throw new OpenDesignAdapterException(400, "OPEN_DESIGN_AGENT_ID is required");
        }
    }

    private void validateQueryParams(OpenDesignQueryParams queryParams) {
        if (StringUtils.isBlank(queryParams.getProjectId())) {
            throw new OpenDesignAdapterException(400, "sessionId is required");
        }
    }

    private boolean hasProjectId(OpenDesignQueryParams queryParams) {
        return StringUtils.isNotBlank(queryParams.getProjectId());
    }

    private boolean hasPrompt(OpenDesignQueryParams queryParams) {
        return StringUtils.isNotBlank(buildPrompt(queryParams));
    }

    private String buildPrompt(OpenDesignQueryParams queryParams) {
        return firstText(queryParams.getPrompt(), queryParams.getCurrentPrompt(), queryParams.getUserGoal(),
            queryParams.getChatInputValue());
    }

    private void assertHealthy(OpenDesignRequestEnvironment env, String requestId) {
        LOGGER.info("Open Design 健康检查开始，requestId：{}，daemonBaseUrl：{}", requestId, env.getDaemonBaseUrl());
        openDesignClient.getHealth(env);
    }

    private OpenDesignProjectContext resolveProjectContext(OpenDesignRequestEnvironment env,
        OpenDesignQueryParams queryParams, String requestId) {
        OpenDesignProjectResponse existingProject = openDesignClient.getProject(env, urlEncode(queryParams.getProjectId()));
        if (existingProject != null && existingProject.getProject() != null) {
            LOGGER.info("Open Design 复用已有项目，requestId：{}，projectId：{}，conversationId：{}", requestId,
                queryParams.getProjectId(), queryParams.getConversationId());
            return new OpenDesignProjectContext(queryParams.getProjectId(), queryParams.getConversationId(), true);
        }

        LOGGER.info("Open Design 创建项目，requestId：{}，projectId：{}", requestId, queryParams.getProjectId());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", queryParams.getProjectId());
        body.put("name", firstText(queryParams.getProjectName(), titleFromPrompt(buildPrompt(queryParams))));
        body.put("skillId", StringUtils.defaultIfBlank(queryParams.getSkillId(), env.getDefaultSkillId()));
        body.put("designSystemId",
            StringUtils.defaultIfBlank(queryParams.getDesignSystemId(), env.getDefaultDesignSystemId()));
        body.put("pendingPrompt", buildPrompt(queryParams));

        Map<String, Object> metadata = new LinkedHashMap<>();
        // 保留来源信息，便于后续在 Open Design 侧区分这类项目是由跳转网关拉起的。
        metadata.put("source", "redirect-gateway");
        metadata.put("userCode", StringUtils.isNotBlank(queryParams.getUserCode()) ? queryParams.getUserCode() : null);
        body.put("metadata", metadata);
        body.put("customInstructions", null);

        OpenDesignCreateProjectResponse createdProject = openDesignClient.createProject(env, body);
        String conversationId = createdProject != null ? createdProject.getConversationId() : "";
        if (StringUtils.isNotBlank(conversationId) || !hasPrompt(queryParams)) {
            return new OpenDesignProjectContext(queryParams.getProjectId(), conversationId, false);
        }
        return new OpenDesignProjectContext(queryParams.getProjectId(),
            firstConversationId(env, queryParams.getProjectId()), false);
    }

    private String firstConversationId(OpenDesignRequestEnvironment env, String projectId) {
        OpenDesignConversationsResponse conversations = openDesignClient.listConversations(env, urlEncode(projectId));
        List<OpenDesignConversationRecord> items = conversations != null ? conversations.getConversations() : null;
        if (items != null && !items.isEmpty()) {
            String conversationId = items.get(0).getId();
            if (StringUtils.isNotBlank(conversationId)) {
                return conversationId;
            }
        }

        // 新建项目理论上会带默认 conversation；若没有，则这里补建一个，保证后续消息有落点。
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "Open Design Prototype");
        OpenDesignConversationResponse created = openDesignClient.createConversation(env, urlEncode(projectId), body);
        String conversationId = created != null && created.getConversation() != null
            ? created.getConversation().getId() : "";
        if (StringUtils.isBlank(conversationId)) {
            throw new OpenDesignAdapterException(502, "Open Design project " + projectId + " has no conversation");
        }
        return conversationId;
    }

    private void syncConversationState(OpenDesignRequestEnvironment env, OpenDesignQueryParams queryParams,
        OpenDesignProjectContext context, OpenDesignRunContext runContext, String requestId) {
        // 顺序与源实现保持一致：先补会话元数据，再写 user/assistant 消息，最后创建 run。
        updateConversationMetadata(env, queryParams, context, runContext, requestId);
        createUserMessage(env, queryParams, context, runContext, requestId);
        createAssistantPlaceholder(env, context, runContext, requestId);
        String runId = dispatchRun(env, queryParams, context, runContext, requestId);
        markAssistantQueued(env, context, runContext, runId, requestId);
    }

    private void updateConversationMetadata(OpenDesignRequestEnvironment env, OpenDesignQueryParams queryParams,
        OpenDesignProjectContext context, OpenDesignRunContext runContext, String requestId) {
        LOGGER.info("Open Design 更新会话信息，requestId：{}，projectId：{}，conversationId：{}", requestId,
            context.getProjectId(), context.getConversationId());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", firstText(queryParams.getConversationTitle(), titleFromPrompt(runContext.getPrompt())));
        body.put("updatedAt", runContext.getStartedAt());
        openDesignClient.updateConversation(env, urlEncode(context.getProjectId()), urlEncode(context.getConversationId()),
            body);
    }

    private void createUserMessage(OpenDesignRequestEnvironment env, OpenDesignQueryParams queryParams,
        OpenDesignProjectContext context, OpenDesignRunContext runContext, String requestId) {
        LOGGER.info("Open Design 写入用户消息，requestId：{}，projectId：{}，conversationId：{}", requestId,
            context.getProjectId(), context.getConversationId());
        putMessage(env, context.getProjectId(), context.getConversationId(), runContext.getUserMessageId(),
            buildUserMessagePayload(queryParams, runContext));
    }

    private Map<String, Object> buildUserMessagePayload(OpenDesignQueryParams queryParams,
        OpenDesignRunContext runContext) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", runContext.getUserMessageId());
        body.put("role", "user");
        body.put("content", runContext.getPrompt());
        body.put("createdAt", runContext.getStartedAt());
        List<Map<String, Object>> attachmentDescriptors = buildAttachmentDescriptors(queryParams.getAttachments());
        if (!attachmentDescriptors.isEmpty()) {
            body.put("attachments", attachmentDescriptors);
        }
        if (!queryParams.getCommentAttachments().isEmpty()) {
            body.put("commentAttachments", queryParams.getCommentAttachments());
        }
        return body;
    }

    private List<Map<String, Object>> buildAttachmentDescriptors(List<String> attachments) {
        if (attachments == null || attachments.isEmpty()) {
            return Collections.emptyList();
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (String item : attachments) {
            if (StringUtils.isBlank(item)) {
                continue;
            }
            Map<String, Object> descriptor = new LinkedHashMap<>();
            // daemon 当前吃的是轻量附件描述，不需要这里预读取文件内容。
            descriptor.put("path", item);
            descriptor.put("name", item);
            descriptor.put("kind", isImagePath(item) ? "image" : "file");
            result.add(descriptor);
        }
        return result;
    }

    private void createAssistantPlaceholder(OpenDesignRequestEnvironment env, OpenDesignProjectContext context,
        OpenDesignRunContext runContext, String requestId) {
        LOGGER.info("Open Design 写入 assistant 占位消息，requestId：{}，projectId：{}，conversationId：{}", requestId,
            context.getProjectId(), context.getConversationId());
        putMessage(env, context.getProjectId(), context.getConversationId(), runContext.getAssistantMessageId(),
            buildAssistantMessagePayload(env, runContext, null, "running"));
    }

    private String dispatchRun(OpenDesignRequestEnvironment env, OpenDesignQueryParams queryParams,
        OpenDesignProjectContext context, OpenDesignRunContext runContext, String requestId) {
        LOGGER.info("Open Design 创建 run，requestId：{}，projectId：{}，conversationId：{}", requestId,
            context.getProjectId(), context.getConversationId());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("agentId", env.getAgentId());
        body.put("message", runContext.getPrompt());
        body.put("currentPrompt", runContext.getPrompt());
        body.put("projectId", context.getProjectId());
        body.put("conversationId", context.getConversationId());
        body.put("assistantMessageId", runContext.getAssistantMessageId());
        body.put("clientRequestId",
            StringUtils.defaultIfBlank(queryParams.getClientRequestId(), UUID.randomUUID().toString()));
        body.put("skillId", StringUtils.defaultIfBlank(queryParams.getSkillId(), env.getDefaultSkillId()));
        if (!queryParams.getSkillIds().isEmpty()) {
            body.put("skillIds", queryParams.getSkillIds());
        }
        body.put("designSystemId",
            StringUtils.defaultIfBlank(queryParams.getDesignSystemId(), env.getDefaultDesignSystemId()));
        if (!queryParams.getAttachments().isEmpty()) {
            body.put("attachments", queryParams.getAttachments());
        }
        if (!queryParams.getCommentAttachments().isEmpty()) {
            body.put("commentAttachments", queryParams.getCommentAttachments());
        }

        OpenDesignRunCreateResponse run = openDesignClient.createRun(env, body);
        String runId = run != null ? run.getRunId() : "";
        if (StringUtils.isBlank(runId)) {
            throw new OpenDesignAdapterException(502, "Open Design did not return runId");
        }
        return runId;
    }

    private void markAssistantQueued(OpenDesignRequestEnvironment env, OpenDesignProjectContext context,
        OpenDesignRunContext runContext, String runId, String requestId) {
        LOGGER.info("Open Design 更新 assistant 消息为 queued，requestId：{}，projectId：{}，conversationId：{}，runId：{}",
            requestId, context.getProjectId(), context.getConversationId(), runId);
        putMessage(env, context.getProjectId(), context.getConversationId(), runContext.getAssistantMessageId(),
            buildAssistantMessagePayload(env, runContext, runId, "queued"));
    }

    private Map<String, Object> buildAssistantMessagePayload(OpenDesignRequestEnvironment env,
        OpenDesignRunContext runContext, String runId, String runStatus) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", runContext.getAssistantMessageId());
        body.put("role", "assistant");
        body.put("content", "");
        body.put("agentId", env.getAgentId());
        body.put("agentName", env.getAgentId());
        body.put("events", Collections.emptyList());
        body.put("createdAt", runContext.getStartedAt());
        body.put("startedAt", runContext.getStartedAt());
        body.put("runStatus", runStatus);
        if (StringUtils.isNotBlank(runId)) {
            body.put("runId", runId);
        }
        return body;
    }

    private void putMessage(OpenDesignRequestEnvironment env, String projectId, String conversationId, String messageId,
        Map<String, Object> body) {
        openDesignClient.putMessage(env, urlEncode(projectId), urlEncode(conversationId), urlEncode(messageId), body);
    }

    private String buildHomeUrl(String routePrefix) {
        return normalizeRoutePrefix(routePrefix) + "/";
    }

    private String buildProjectUrl(String routePrefix, String projectId, String conversationId) {
        String basePath = normalizeRoutePrefix(routePrefix);
        String projectPath = StringUtils.isNotBlank(conversationId)
            ? "/projects/" + urlEncode(projectId) + "/conversations/" + urlEncode(conversationId)
            : "/projects/" + urlEncode(projectId);
        return basePath + projectPath;
    }

    private OpenDesignRunContext buildRunContext(OpenDesignQueryParams queryParams) {
        long startedAt = System.currentTimeMillis();
        String prompt = buildPrompt(queryParams);
        String userMessageId = StringUtils.defaultIfBlank(queryParams.getUserMessageId(), UUID.randomUUID().toString());
        String assistantMessageId = StringUtils.defaultIfBlank(queryParams.getAssistantMessageId(),
            UUID.randomUUID().toString());
        return new OpenDesignRunContext(startedAt, prompt, userMessageId, assistantMessageId);
    }

    private List<String> parseStringList(Object value) {
        if (value == null) {
            return Collections.emptyList();
        }
        if (value instanceof List<?>) {
            List<String> result = new ArrayList<>();
            for (Object item : (List<?>) value) {
                String text = trimToNull(item);
                if (text != null) {
                    result.add(text);
                }
            }
            return result;
        }
        if (value instanceof String) {
            String text = ((String) value).trim();
            if (text.isEmpty()) {
                return Collections.emptyList();
            }
            try {
                List<String> parsed = OBJECT_MAPPER.readValue(text, new TypeReference<List<String>>() {
                });
                if (parsed != null) {
                    List<String> result = new ArrayList<>();
                    for (String item : parsed) {
                        if (StringUtils.isNotBlank(item)) {
                            result.add(item.trim());
                        }
                    }
                    return result;
                }
            }
            catch (Exception ignored) {
            }
            List<String> result = new ArrayList<>();
            for (String item : text.split(",")) {
                if (StringUtils.isNotBlank(item)) {
                    result.add(item.trim());
                }
            }
            return result;
        }
        return Collections.emptyList();
    }

    private String firstText(Object... values) {
        for (Object value : values) {
            String text = trimToNull(value);
            if (text != null) {
                return text;
            }
        }
        return "";
    }

    private String normalizeOptionalString(Object value) {
        return trimToNull(value);
    }

    private String trimToEmpty(Object value) {
        return StringUtils.defaultString(trimToNull(value));
    }

    private String trimToNull(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? null : text;
    }

    private String trimTrailingSlash(String value) {
        return value == null ? "" : value.replaceAll("/+$", "");
    }

    private String urlEncode(String value) {
        return URLEncoder.encode(StringUtils.defaultString(value), StandardCharsets.UTF_8);
    }

    private String normalizeRoutePrefix(String routePrefix) {
        String prefix = StringUtils.defaultIfBlank(routePrefix, OPEN_DESIGN_ROUTE_PREFIX);
        prefix = prefix.startsWith("/") ? prefix : "/" + prefix;
        return StringUtils.removeEnd(prefix, "/");
    }

    private boolean isImagePath(String value) {
        return value != null && value.matches("(?i).+\\.(png|jpe?g|gif|webp|avif|svg)$");
    }

    private String titleFromPrompt(String value) {
        String text = StringUtils.normalizeSpace(StringUtils.defaultString(value));
        if (text.length() > 48) {
            return text.substring(0, 45) + "...";
        }
        return StringUtils.isNotBlank(text) ? text : "Open Design Prototype";
    }

    private static ObjectMapper createObjectMapper() {
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        return objectMapper;
    }
}
