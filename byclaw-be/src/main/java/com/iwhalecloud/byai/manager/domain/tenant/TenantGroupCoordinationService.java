package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageIds;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.ChatTurnPreparationException;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionContextFileService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder;

import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatGatewayRequestDecorator;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupWorkAssistantService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCoordinationService;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Tenant task scopes come from Node, never from client-supplied execution parameters. */
@Service
public class TenantGroupCoordinationService implements ChatGatewayRequestDecorator {
    private final TenantNodeClient node;
    private final GroupWorkAssistantService assistants;
    private final SsResourceService resources;
    private final AuthApplicationService authorization;
    private GroupChatSessionContextFileService contextFiles;
    private GroupChatDispatchPromptBuilder prompts;
    private UserService users;
    private final ObjectMapper historyMapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    @org.springframework.beans.factory.annotation.Autowired
    public void configureHistory(GroupChatSessionContextFileService files, GroupChatDispatchPromptBuilder prompts, UserService users) {
        this.contextFiles = files;
        this.prompts = prompts;
        this.users = users;
    }

    public TenantGroupCoordinationService(TenantNodeClient node, GroupWorkAssistantService assistants,
        SsResourceService resources, AuthApplicationService authorization) {
        this.node = node;
        this.assistants = assistants;
        this.resources = resources;
        this.authorization = authorization;
    }

    public Map<String, Object> coordinator(TenantRequestContext tenant, Long groupId) {
        Map<String, Object> group = node.request(tenant, "GET", "/internal/v1/group-chats/" + groupId,
            null, new TypeReference<Map<String, Object>>() { });
        Object bound = group.get("coordinatorAgentId");
        Long coordinatorId = bound == null ? assistants.resolveDefaultCoordinatorId() : Long.valueOf(bound.toString());
        var resource = resources.findById(coordinatorId);
        if (resource == null || !Integer.valueOf(2).equals(resource.getResourceStatus())
            || !"DIG_EMPLOYEE".equals(resource.getResourceBizType())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Group coordinator is unavailable");
        }
        // Default membership is server-managed. Existing group users receive the same grant as new groups.
        if (bound == null && group.get("members") instanceof List<?> members) {
            for (Object value : members) {
                if (value instanceof Map<?, ?> member && "USER".equals(member.get("memObjType"))) {
                    authorization.grantDigitalEmployeesToUser(List.of(coordinatorId),
                        Long.valueOf(member.get("memObjId").toString()));
                }
            }
        }
        return Map.of("coordinatorAgentId", coordinatorId.toString(), "coordinatorName", resource.getResourceName(),
            "coordinatorAuthorized", true);
    }

    @SuppressWarnings("unchecked")
    public void validateRequest(AssistantChatDto request) {
        TenantRequestContext tenant = TenantRequestContextHolder.get();
        validateRequest(tenant, request);
    }

    @SuppressWarnings("unchecked")
    private void validateRequest(TenantRequestContext tenant, AssistantChatDto request) {
        if (tenant == null || request == null || request.getSessionId() == null) return;
        Map<String, Object> session = node.request(tenant, "GET", "/internal/v1/sessions/" + request.getSessionId(),
            null, new TypeReference<Map<String, Object>>() { });
        Map<String, Object> params = request.getExtParams() == null ? new HashMap<>() : new HashMap<>(request.getExtParams());
        params.remove("groupCoordination");
        params.remove("groupCoordinator");
        params.remove("groupChat");
        params.remove("groupContextSnapshot");
        params.remove("groupPublicContext");
        params.remove("groupTaskContext");
        Object stored = session.get("groupCoordination");
        if (stored instanceof Map<?, ?>) {
            Map<String, Object> scope = (Map<String, Object>) stored;
            String target = String.valueOf(session.get("targetAgentId"));
            boolean child = Boolean.TRUE.equals(session.get("groupCoordinationChild"));
            if (!"byclaw.group-coordination/v1".equals(scope.get("schemaVersion"))
                || !child && !request.getSessionId().toString().equals(scope.get("taskSessionId"))) throw forbidden();
            if ("COORDINATED".equals(scope.get("mode")) && !child && !target.equals(scope.get("coordinatorAgentId"))) {
                throw forbidden();
            }
            if ("COORDINATED".equals(scope.get("mode"))
                && (params.containsKey("multiAgent") || params.containsKey("multi_agent"))) throw forbidden();
            List<String> allowed = scope.get("allowedAgentIds") instanceof List<?> ids
                ? ids.stream().map(Object::toString).toList() : List.of();
            Map<String, Object> group = node.request(tenant, "GET", "/internal/v1/group-chats/" + scope.get("groupSessionId"),
                null, new TypeReference<Map<String, Object>>() { });
            List<String> currentMembers = group.get("members") instanceof List<?> rows ? rows.stream()
                .filter(value -> value instanceof Map<?, ?> member && "AGENT".equals(member.get("memObjType")))
                .map(value -> String.valueOf(((Map<?, ?>) value).get("memObjId"))).toList() : List.of();
            if (!currentMembers.contains(String.valueOf(scope.get("coordinatorAgentId")))) throw forbidden();
            if (!currentMembers.containsAll(allowed)) throw forbidden();
            if (request.getAgentId() == null) throw forbidden();
            String actualAgentId = request.getAgentId().toString();
            if (!currentMembers.contains(actualAgentId)) throw forbidden();
            if (child && !target.equals(actualAgentId)) throw forbidden();
            if ("COORDINATED".equals(scope.get("mode")) && !target.equals(actualAgentId)) throw forbidden();
            if (!allowed.contains(actualAgentId) && !actualAgentId.equals(scope.get("coordinatorAgentId"))) throw forbidden();
            if (request.getResourceList() != null) request.getResourceList().forEach(resource -> {
                if (AgentMetaEnum.DIG_EMPLOYEE.equals(resource.getResourceType())
                    && (!currentMembers.contains(String.valueOf(resource.getResourceId()))
                        || !allowed.contains(String.valueOf(resource.getResourceId()))
                            && !String.valueOf(scope.get("coordinatorAgentId")).equals(String.valueOf(resource.getResourceId()))))
                    throw forbidden();
            });
            params.put("groupCoordination", scope);
        }
        request.setExtParams(params);
    }

    @Override
    public Object decorate(ChatProcessContext context, Object content, Map<String, Object> gatewayParams) {
        if (context == null || context.tenantContext == null) return content;
        validateRequest(context.tenantContext, context.assistantChatDto);
        Object scope = context.assistantChatDto.getExtParams().get("groupCoordination");
        if (!(scope instanceof Map<?, ?> map)) return content;
        gatewayParams.put("groupCoordination", scope);
        GroupChatCoordinationService.attachDshTarget(context.assistantChatDto, map, gatewayParams);
        String coordinatorId = String.valueOf(map.get("coordinatorAgentId"));
        var coordinator = resources.findById(Long.valueOf(coordinatorId));
        if (coordinator == null) throw forbidden();
        Map<String, Object> coordinatorMetadata = new HashMap<>();
        coordinatorMetadata.put("id", coordinatorId);
        coordinatorMetadata.put("name", coordinator.getResourceName());
        if (coordinator.getWorkerAgentType() != null && !coordinator.getWorkerAgentType().isBlank()) {
            coordinatorMetadata.put("agentType", coordinator.getWorkerAgentType());
            coordinatorMetadata.put("workerAgentType", coordinator.getWorkerAgentType());
        }
        gatewayParams.put("groupCoordinator", coordinatorMetadata);
        Object decorated = appendHistory(context, map, content, gatewayParams);
        gatewayParams.put("cwd", "/by/.sessions/" + context.sessionId);
        // Reuse the ordinary task contract, including the explicit user-confirmed publication intent.
        decorated = decorateText(decorated, text -> {
            String delivery = prompts.appendTaskDeliveryReminder(text, context.sessionId);
            return "prepare_group_task_publication".equals(context.assistantChatDto.getMessageIntent())
                ? prompts.appendPublicationPreparation(delivery, context.sessionId) : delivery;
        });
        if ("COORDINATED".equals(map.get("mode"))) {
            return decorateText(decorated, text -> text + "\n\n本次请求已由平台确定为 GROUP_TASK。你是群组工作助手，只能协调本次 allowedAgentIds 中的数字员工。"
                + "通过结构化协作工具委派并接收结果；正文中的 @ 仅用于展示。不要重新判断或降级为 CHAT。"
                + "任务成果沿现有待发布确认流程交付。");
        }
        if ("DIRECT".equals(map.get("mode"))) {
            return decorateText(decorated, text -> text + "\n\n你正在工作组中处理自己的任务。需要协助时，仅向群组工作助手（ID=" + coordinatorId
                + "，名称=" + coordinator.getResourceName() + "）提交关联当前任务的结构化协助请求。"
                + "不要直接委派其他数字员工；正文中的 @ 只展示，不构成执行请求。"
                + "协助结果用于继续当前任务，缺少用户必须提供的材料时向用户询问。");
        }
        return decorated;
    }

    private Object appendHistory(ChatProcessContext context, Map<?, ?> scope, Object content, Map<String, Object> gatewayParams) {
        if (context.userMessageId == null || context.traceId == null || contextFiles == null) {
            throw new ChatTurnPreparationException("历史上下文身份不完整，请重试", null);
        }
        List<MessageView> inputs = node.request(context.tenantContext, "POST", "/internal/v1/assiman/getMessageByIds",
            new MessageIds(List.of(context.userMessageId)), new TypeReference<List<MessageView>>() { });
        if (inputs == null || inputs.size() != 1) throw forbidden();
        MessageView input = inputs.get(0);
        if (!context.userMessageId.toString().equals(input.getMessageId())
            || !context.sessionId.toString().equals(input.getSessionId()) || !Integer.valueOf(1).equals(input.getUsage())
            || !Long.toString(context.tenantContext.userId()).equals(input.getCreatorId()) || Boolean.TRUE.equals(input.getRecalled())) throw forbidden();
        JSONObject metadata = input.getMetadata() == null ? new JSONObject() : JSON.parseObject(input.getMetadata());
        JSONObject frozen = metadata.getJSONObject("groupPublicContext");
        String groupId = String.valueOf(scope.get("groupSessionId"));
        String boundary;
        if (frozen == null) {
            // Legacy resumed inputs keep the original task boundary rather than expanding on each retry.
            Map<String, Object> task = node.request(context.tenantContext, "GET", "/internal/v1/group-chat/tasks/" + scope.get("taskSessionId"),
                null, new TypeReference<Map<String, Object>>() { });
            if (!groupId.equals(String.valueOf(task.get("groupSessionId")))
                || !Long.toString(context.tenantContext.userId()).equals(String.valueOf(task.get("initiatorUserId")))) throw forbidden();
            boundary = String.valueOf(task.get("sourceMessageId"));
        }
        else {
            if (!groupId.equals(frozen.getString("groupSessionId"))) throw forbidden();
            boundary = frozen.getString("beforeMessageId");
        }
        if (boundary == null || !boundary.matches("[1-9][0-9]*")) throw forbidden();
        Map<String, Object> raw = node.request(context.tenantContext, "POST", "/internal/v1/group-chats/" + groupId + "/context",
            Map.of("beforeMessageId", boundary, "maxMessages", 60, "maxCharacters", 30000, "agentContext", true),
            new TypeReference<Map<String, Object>>() { });
        GroupChatContextResponse snapshot = historyMapper.convertValue(raw, GroupChatContextResponse.class);
        GroupChatContextRequest request = new GroupChatContextRequest();
        request.setConversationKey(groupId);
        request.setBeforeMessageId(boundary);
        request.setChildSessionId(context.sessionId);
        request.setInitiatorUserId(context.tenantContext.userId());
        request.setTargetAgentId(context.assistantChatDto.getAgentId());
        var initiator = users.findById(context.tenantContext.userId());
        if (initiator == null) throw forbidden();
        var file = contextFiles.prepareGroupSnapshot(initiator.getUserCode(), request, context.traceId, context.userMessageId, snapshot);
        gatewayParams.put("groupContextSnapshot", file.snapshot());
        gatewayParams.put("groupChat", Map.of("schemaVersion", "byclaw.group-chat-ref/v1", "conversationKey", groupId,
            "beforeMessageId", boundary, "childSessionId", context.sessionId.toString(),
            "initiatorUserId", context.tenantContext.userId(), "targetAgentId", context.assistantChatDto.getAgentId()));
        return decorateText(content, text -> prompts.appendGroupHistory(text, file));
    }

    private Object decorateText(Object content, UnaryOperator<String> decorator) {
        if (content instanceof String text) return decorator.apply(text);
        if (content instanceof JSONArray array) {
            JSONArray copy = JSON.parseArray(array.toJSONString());
            for (int index = 0; index < copy.size(); index++) {
                JSONObject message = copy.getJSONObject(index);
                JSONObject body = message.getJSONObject("content");
                if ("user".equals(message.getString("role")) && body != null && body.get("text") instanceof String text) {
                    body.put("text", decorator.apply(text));
                    return copy;
                }
            }
        }
        throw new ChatTurnPreparationException("群任务消息缺少正文，请重试", null);
    }

    private ResponseStatusException forbidden() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, "Group task execution is outside its assigned scope");
    }
}
