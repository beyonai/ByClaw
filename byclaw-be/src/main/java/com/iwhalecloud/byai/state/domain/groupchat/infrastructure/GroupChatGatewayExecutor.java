package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.UnaryOperator;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageResourceDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatGatewayRequestDecorator;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.ChatTurnPreparationException;
import com.iwhalecloud.byai.state.domain.chat.service.ScriptService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMemberUidCodec;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder.GroupMemberPrompt;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** Adapts group dispatch to the ordinary private session runtime and decorates its Gateway request. */
@Service
public class GroupChatGatewayExecutor implements ChatGatewayRequestDecorator {
    @Autowired
    private ApplicationEventPublisher schedulingEvents;

    private void observeStarted(ByaiGroupChatExecution execution) {
        if (schedulingEvents != null && "UNKNOWN".equals(execution.getDisposition())) {
            schedulingEvents.publishEvent(new GroupChatExecutionStarted(execution.getExecutionId(),
                execution instanceof ByaiGroupChatTurn, execution.getTraceId()));
        }
    }

    private static final int AGENT_HISTORY_PAGE_SIZE = 50;
    private final ScriptService scriptService;
    private final ByaiMessageMapper messageMapper;
    private final UserService userService;
    private final SsResourceService resourceService;
    private final GroupChatContextTokenService tokenService;
    private final GroupChatDispatchPromptBuilder promptBuilder;
    private final SessionMemberService memberService;
    private final GroupChatMemberUidCodec uidCodec;
    private final ByaiGroupChatExecutionMapper executionMapper;
    private final SequenceService sequenceService;
    private final SandboxUserContextRunner userContextRunner;
    private final ByaiGroupChatTurnMapper turnMapper;
    private final SessionService sessionService;
    private TransactionTemplate turnTransaction;
    private ByaiGroupChatTaskMapper taskMapper;
    private GroupChatSessionContextFileService contextFileService;
    private GroupChatTaskAuthorizationService taskAuthorizationService;

    @Autowired
    public void configureContextFiles(GroupChatSessionContextFileService contextFileService,
        GroupChatTaskAuthorizationService taskAuthorizationService) {
        this.contextFileService = contextFileService;
        this.taskAuthorizationService = taskAuthorizationService;
    }

    @Autowired
    public void configureTurnTransactions(PlatformTransactionManager transactionManager, ByaiGroupChatTaskMapper taskMapper) {
        this.turnTransaction = new TransactionTemplate(transactionManager);
        this.taskMapper = taskMapper;
    }

    public GroupChatGatewayExecutor(ScriptService scriptService, ByaiMessageMapper messageMapper,
        UserService userService, SsResourceService resourceService,
        GroupChatContextTokenService tokenService, GroupChatDispatchPromptBuilder promptBuilder,
        SessionMemberService memberService, GroupChatMemberUidCodec uidCodec,
        ByaiGroupChatExecutionMapper executionMapper, SequenceService sequenceService,
        SandboxUserContextRunner userContextRunner) {
        this(scriptService, messageMapper, userService, resourceService, tokenService, promptBuilder,
            memberService, uidCodec, executionMapper, sequenceService, userContextRunner, null, null);
    }

    @Autowired
    public GroupChatGatewayExecutor(ScriptService scriptService, ByaiMessageMapper messageMapper,
        UserService userService, SsResourceService resourceService,
        GroupChatContextTokenService tokenService, GroupChatDispatchPromptBuilder promptBuilder,
        SessionMemberService memberService, GroupChatMemberUidCodec uidCodec,
        ByaiGroupChatExecutionMapper executionMapper, SequenceService sequenceService,
        SandboxUserContextRunner userContextRunner, ByaiGroupChatTurnMapper turnMapper, SessionService sessionService) {
        this.scriptService = scriptService;
        this.messageMapper = messageMapper;
        this.userService = userService;
        this.resourceService = resourceService;
        this.tokenService = tokenService;
        this.promptBuilder = promptBuilder;
        this.memberService = memberService;
        this.uidCodec = uidCodec;
        this.executionMapper = executionMapper;
        this.sequenceService = sequenceService;
        this.userContextRunner = userContextRunner;
        this.turnMapper = turnMapper;
        this.sessionService = sessionService;
    }

    public void execute(ByaiGroupChatExecution execution, String workspace) {
        Users initiator = userService.findById(execution.getInitiatorUserId());
        if (initiator == null || resourceService.findById(execution.getTargetAgentId()) == null) {
            throw new IllegalArgumentException("Group execution resources are unavailable");
        }
        // The candidate already owns the original message, including its complete resourceList.
        ByaiMessage child = messageMapper.selectBySessionId(execution.getCandidateSessionId()).stream()
            .filter(message -> Integer.valueOf(1).equals(message.getUsage()))
            .findFirst().orElseThrow(() -> new IllegalStateException("Candidate user message is unavailable"));
        ByaiMessageHotDtoDto existing = new ByaiMessageHotDtoDto();
        BeanUtils.copyProperties(child, existing);
        AssistantChatDto dto = new AssistantChatDto();
        dto.setSessionId(execution.getCandidateSessionId());
        dto.setProjectId(child.getProjectId());
        dto.setAgentId(execution.getTargetAgentId());
        dto.setAgentType("001");
        dto.setChatContent(child.getMessageContent());
        dto.setFiles(filesFromResources(child.getRelatedResources()));
        dto.setLlmMessageId(sequenceService.nextVal());
        dto.setClientRequestId(child.getMessageId() + "_" + dto.getLlmMessageId());
        JSONObject metadata = child.getMetadata() == null ? new JSONObject() : JSON.parseObject(child.getMetadata());
        if (metadata != null && metadata.getJSONArray("resourceList") != null) {
            dto.setResourceList(metadata.getJSONArray("resourceList").toJavaList(ResourceVo.class));
        }
        // Bind before registering the listener or sending, so immediate events and recovery use the same trace.
        String traceId = ScriptService.getTraceId(child.getMessageId(), dto.getLlmMessageId());
        if (executionMapper.bindRuntime(execution.getExecutionId(), traceId) != 1) {
            throw new IllegalStateException("Group execution is no longer running");
        }
        execution.setTraceId(traceId);
        observeStarted(execution);
        userContextRunner.runAsUser(initiator.getUserCode(), () -> {
            try {
                scriptService.startExistingMessageTurn(dto, existing);
            }
            catch (Exception error) {
                throw new IllegalStateException("Unable to start group candidate turn", error);
            }
        });
    }

    /** Starts exactly the queued input, including when the target session already contains earlier turns. */
    public void executeTurn(ByaiGroupChatTurn turn) {
        PreparedTurn prepared = turnTransaction.execute(status -> prepareTurn(turn.getExecutionId()));
        if (prepared == null) {
            return;
        }
        turn.setTraceId(ScriptService.getTraceId(prepared.message().getMessageId(), prepared.request().getLlmMessageId()));
        observeStarted(turn);
        userContextRunner.runAsUser(prepared.userCode(), () -> {
            try {
                scriptService.startExistingMessageTurn(prepared.request(), prepared.message());
            }
            catch (Exception error) {
                throw new IllegalStateException("Unable to start queued group turn", error);
            }
        });
    }

    private PreparedTurn prepareTurn(Long turnId) {
        // A repeated unbound claim may race a live worker; one transaction owns both input creation and trace binding.
        ByaiGroupChatTurn turn = turnMapper.selectForUpdateById(turnId);
        if (turn == null || !"RUNNING".equals(turn.getStatus()) || turn.getTraceId() != null) {
            return null;
        }
        ByaiGroupChatTask task = taskMapper.selectById(turn.getCandidateSessionId());
        if ((task != null && "ACTIVE".equals(task.getStatus()))
            || memberService.findSessionMember(turn.getGroupSessionId(), "USER", turn.getInitiatorUserId()) == null
            || memberService.findSessionMember(turn.getGroupSessionId(), "AGENT", turn.getTargetAgentId()) == null) {
            throw new IllegalArgumentException("Queued group turn is no longer authorized to continue");
        }
        Long runtimeSessionId = Long.valueOf(turn.getGatewaySessionId());
        Users initiator = userService.findById(turn.getInitiatorUserId());
        ByaiSession session = sessionService.findById(runtimeSessionId);
        if (initiator == null || session == null || turn.getInputMessageId() == null
            || !Objects.equals(session.getCreatorId(), turn.getInitiatorUserId())
            || !Objects.equals(session.getObjectId(), turn.getTargetAgentId())
            || resourceService.findById(turn.getTargetAgentId()) == null) {
            throw new IllegalArgumentException("Queued group turn requires an owned target session and input");
        }
        JSONObject input = JSON.parseObject(turn.getInputContent());
        if (input == null || !(input.get("本次消息") instanceof String messageContent)) {
            throw new IllegalArgumentException("Queued group turn requires textual current message content");
        }
        ByaiMessage child = messageMapper.selectByMessageId(turn.getInputMessageId());
        ByaiMessage source = "USER".equals(turn.getSenderType())
            ? messageMapper.selectByMessageId(turn.getTriggerMessageId()) : null;
        if (source != null && !Objects.equals(source.getSessionId(), turn.getGroupSessionId())) {
            throw new IllegalArgumentException("Group turn source does not belong to its group");
        }
        if (child == null) {
            child = new ByaiMessage();
            child.setId(turn.getInputMessageId());
            child.setMessageId(turn.getInputMessageId());
            child.setSessionId(runtimeSessionId);
            child.setProjectId(session.getProjectId());
            // Normal runtime authorization uses creatorId; actual message authorship is retained in metadata/input.
            child.setCreatorId(turn.getInitiatorUserId());
            child.setCreatorName(initiator.getUserName());
            // 页面、历史记录及普通运行时均使用原始正文，内部调度上下文仅在出站装饰时追加。
            child.setMessageContent(messageContent);
            if (source != null) {
                child.setRelatedResources(source.getRelatedResources());
            }
            child.setMetadata(turn.getInputMetadata());
            child.setUsage(1);
            child.setIsComplete(true);
            child.setCreateTime(new Date());
            child.setUpdateTime(new Date());
            messageMapper.insert(child);
        }
        else if (!Objects.equals(child.getSessionId(), runtimeSessionId)
            || !Objects.equals(child.getCreatorId(), turn.getInitiatorUserId())
            || !Integer.valueOf(1).equals(child.getUsage())
            || !Objects.equals(child.getMessageContent(), messageContent)) {
            throw new IllegalArgumentException("Queued input does not match its persisted message");
        }
        ByaiMessageHotDtoDto existing = new ByaiMessageHotDtoDto();
        BeanUtils.copyProperties(child, existing);
        AssistantChatDto dto = new AssistantChatDto();
        dto.setSessionId(runtimeSessionId);
        dto.setProjectId(child.getProjectId());
        dto.setAgentId(turn.getTargetAgentId());
        dto.setAgentType("001");
        dto.setChatContent(child.getMessageContent());
        dto.setFiles(filesFromResources(source == null ? child.getRelatedResources() : source.getRelatedResources()));
        dto.setLlmMessageId(sequenceService.nextVal());
        dto.setClientRequestId(child.getMessageId() + "_" + dto.getLlmMessageId());
        JSONObject metadata = child.getMetadata() == null ? new JSONObject() : JSON.parseObject(child.getMetadata());
        if (metadata != null && metadata.getJSONArray("resourceList") != null) {
            dto.setResourceList(metadata.getJSONArray("resourceList").toJavaList(ResourceVo.class));
        }
        String traceId = ScriptService.getTraceId(child.getMessageId(), dto.getLlmMessageId());
        if (turnMapper.bindRuntime(turn.getExecutionId(), traceId) != 1) {
            throw new IllegalStateException("Queued turn no longer owns its runtime slot");
        }
        return new PreparedTurn(dto, existing, initiator.getUserCode());
    }

    private record PreparedTurn(AssistantChatDto request, ByaiMessageHotDtoDto message, String userCode) {
    }

    /** 恢复当前群消息的原始文件载荷，供 RouteService 构造 Gateway 的 text/files 消息。 */
    private List<MessageFileDto> filesFromResources(String json) {
        if (StringUtils.isBlank(json)) {
            return null;
        }
        try {
            MessageResourceDto resources = JSON.parseObject(json, MessageResourceDto.class);
            return resources == null ? null : resources.getFiles();
        }
        catch (RuntimeException ignored) {
            // 历史附件关联损坏时仍允许派发正文，不能凭无法解析的元数据构造文件载荷。
            return null;
        }
    }

    @Override
    public Object decorate(ChatProcessContext context, Object content, Map<String, Object> gatewayParams) {
        if (context == null || context.sessionId == null) {
            return content;
        }
        ByaiGroupChatTurn turn = turnMapper == null || context.traceId == null
            ? null : turnMapper.selectByTrace(context.traceId);
        ByaiGroupChatExecution execution = turn == null
            ? executionMapper.selectByCandidateSessionId(context.sessionId) : turn;
        if (execution == null) {
            return content;
        }
        boolean dispatchedTurn = turn != null || Objects.equals(execution.getTraceId(), context.traceId);
        ByaiGroupChatTask task = !dispatchedTurn && taskMapper != null
            ? taskMapper.selectById(context.sessionId) : null;
        if (!Objects.equals(context.userId, execution.getInitiatorUserId()) || context.assistantChatDto == null) {
            throw new IllegalArgumentException("Group candidate runtime identity does not match its dispatch");
        }
        if (task != null) {
            // 私有任务续聊可以更换群内执行者，但不能重写最初派发身份或群历史边界。
            taskAuthorizationService.requireActiveAgent(context.sessionId, context.assistantChatDto.getAgentId());
        }
        else if (!Objects.equals(context.assistantChatDto.getAgentId(), execution.getTargetAgentId())) {
            throw new IllegalArgumentException("Group candidate runtime identity does not match its dispatch");
        }
        if (turn != null && !Objects.equals(String.valueOf(context.sessionId), turn.getGatewaySessionId())) {
            throw new IllegalArgumentException("Group turn trace does not belong to this runtime session");
        }
        Long boundary = turn != null ? turn.getPublicBoundaryMessageId()
            : "CONVERSATION".equals(execution.getStatus()) && execution.getReplyToMessageId() != null
                ? execution.getReplyToMessageId() : execution.getSourceMessageId();
        // New turns carry their own public boundary; legacy/private task turns keep the anchor boundary.
        Map<String, Object> groupChat = new HashMap<>();
        groupChat.put("schemaVersion", "byclaw.group-chat-ref/v1");
        groupChat.put("conversationKey", String.valueOf(execution.getGroupSessionId()));
        groupChat.put("beforeMessageId", String.valueOf(boundary));
        groupChat.put("contextToken", tokenService.issue(execution.getGroupSessionId(), context.sessionId,
            execution.getInitiatorUserId(), execution.getTargetAgentId(), boundary));
        groupChat.put("childSessionId", context.sessionId);
        groupChat.put("initiatorUserId", execution.getInitiatorUserId());
        groupChat.put("targetAgentId", execution.getTargetAgentId());
        gatewayParams.put("groupChat", groupChat);
        gatewayParams.put("cwd", "/by/.sessions/" + context.sessionId);
        GroupChatContextRequest historyRequest = new GroupChatContextRequest();
        historyRequest.setConversationKey(String.valueOf(execution.getGroupSessionId()));
        historyRequest.setBeforeMessageId(String.valueOf(boundary));
        historyRequest.setContextToken((String) groupChat.get("contextToken"));
        historyRequest.setChildSessionId(context.sessionId);
        historyRequest.setInitiatorUserId(execution.getInitiatorUserId());
        historyRequest.setTargetAgentId(execution.getTargetAgentId());
        Object decorated = content;
        if (task == null || hasAgentChanged(context, execution.getTargetAgentId())) {
            Users initiator = userService.findById(execution.getInitiatorUserId());
            if (initiator == null) {
                throw new IllegalArgumentException("Group execution initiator is unavailable");
            }
            if (task == null) {
                GroupChatSessionContextFileService.ContextFile groupHistory = contextFileService.prepareGroupHistory(
                    initiator.getUserCode(), historyRequest, context.traceId, context.userMessageId);
                decorated = decorateText(content, text -> promptBuilder.appendGroupHistory(text, groupHistory));
            }
            else {
                GroupChatSessionContextFileService.TaskHandoffHistory handoff = contextFileService.prepareTaskHandoffHistory(
                    initiator.getUserCode(), historyRequest, context.traceId, context.userMessageId);
                decorated = decorateText(content, text -> promptBuilder.appendTaskHandoffHistory(text, handoff));
            }
        }
        if (Objects.equals(execution.getTraceId(), context.traceId) && "RUNNING".equals(execution.getStatus())) {
            return decorateText(decorated, text -> {
                String dispatchContent = turn == null ? text : promptBuilder.appendTurnContext(text, turn.getInputContent());
                if (turn != null && "CHAT_CONTINUATION".equals(turn.getPhase())) {
                    return promptBuilder.appendChatContinuation(dispatchContent, buildMemberRoster(execution));
                }
                return promptBuilder.appendTaskDeliveryReminder(promptBuilder.append(dispatchContent,
                    execution.getExecutionId(), context.sessionId, buildMemberRoster(execution)), context.sessionId);
            });
        }
        // 私有任务续聊不重复分类，文件提示和交付提醒只作用于出站请求。
        return task == null ? decorated : decorateText(decorated,
            text -> promptBuilder.appendTaskDeliveryReminder(text, context.sessionId));
    }

    /** 比较最近实际回答者而非初始归属，确保 B 连续对话不重复交接，切回 A 时仍会交接。 */
    private boolean hasAgentChanged(ChatProcessContext context, Long initialAgentId) {
        try {
            Long before = Objects.requireNonNull(context.userMessageId, "Missing task input boundary");
            while (true) {
                List<ByaiMessage> answers = Objects.requireNonNull(messageMapper.selectPreviousTaskAnswers(
                    context.sessionId, before, AGENT_HISTORY_PAGE_SIZE), "Missing task answer history");
                for (ByaiMessage answer : answers) {
                    if (answer.getMessageId() == null || answer.getMessageId() >= before) {
                        throw new IllegalStateException("Invalid task answer history order");
                    }
                    before = answer.getMessageId();
                    Long previousAgentId = previousAgentId(answer);
                    if (previousAgentId != null) {
                        return !Objects.equals(context.assistantChatDto.getAgentId(), previousAgentId);
                    }
                }
                if (answers.size() < AGENT_HISTORY_PAGE_SIZE) {
                    return !Objects.equals(context.assistantChatDto.getAgentId(), initialAgentId);
                }
            }
        }
        catch (RuntimeException error) {
            throw new ChatTurnPreparationException("历史上下文准备失败，请重试", error);
        }
    }

    private Long previousAgentId(ByaiMessage answer) {
        if (StringUtils.isBlank(answer.getMetadata())) {
            return null;
        }
        try {
            JSONObject metadata = JSON.parseObject(answer.getMetadata());
            // 文件准备失败也会留下空回答，不能把尚未执行的 Agent 当作已完成交接。
            if (metadata == null || (Boolean.TRUE.equals(metadata.getBoolean("turnFailed"))
                && StringUtils.isBlank(answer.getMessageContent()))) {
                return null;
            }
            String agentId = metadata.getString("agentId");
            return agentId != null && agentId.matches("[0-9]+") && Long.parseLong(agentId) > 0
                ? Long.valueOf(agentId) : null;
        }
        catch (RuntimeException ignored) {
            // 兼容缺少有效执行身份的旧记录，继续查找此前的实际回答者。
            return null;
        }
    }

    /** RouteService 的附件消息携带嵌套 text；复制出站载荷，避免修改原始消息和附件。 */
    private Object decorateText(Object content, UnaryOperator<String> decorator) {
        if (content instanceof String text) {
            return decorator.apply(text);
        }
        if (content instanceof JSONArray array) {
            JSONArray copy = JSON.parseArray(array.toJSONString());
            for (int index = 0; index < copy.size(); index++) {
                JSONObject message = copy.getJSONObject(index);
                if (!"user".equals(message.getString("role"))) {
                    continue;
                }
                JSONObject body = message.getJSONObject("content");
                if (body != null && body.get("text") instanceof String text) {
                    body.put("text", decorator.apply(text));
                    return copy;
                }
            }
        }
        throw new IllegalArgumentException("Group dispatch requires textual message content");
    }

    private List<GroupMemberPrompt> buildMemberRoster(ByaiGroupChatExecution execution) {
        List<GroupMemberPrompt> roster = new ArrayList<>();
        List<ByaiSessionMember> members = memberService.findSessionMembers(execution.getGroupSessionId(), null, null);
        if (members == null) {
            return roster;
        }
        for (ByaiSessionMember member : members) {
            if (member == null || member.getMemObjId() == null || member.getMemObjId() <= 0) {
                continue;
            }
            if (MemObjType.AGENT.name().equals(member.getMemObjType())
                && execution.getTargetAgentId().equals(member.getMemObjId())) {
                continue;
            }
            if (MemObjType.USER.name().equals(member.getMemObjType())) {
                Users user = userService.findById(member.getMemObjId());
                if (user != null && user.getUserName() != null) {
                    roster.add(new GroupMemberPrompt(user.getUserName(),
                        uidCodec.encode(AgentMetaEnum.HUMAN, member.getMemObjId())));
                }
            }
            else if (MemObjType.AGENT.name().equals(member.getMemObjType())) {
                SsResource memberAgent = resourceService.findById(member.getMemObjId());
                if (memberAgent != null && memberAgent.getResourceName() != null) {
                    roster.add(new GroupMemberPrompt(memberAgent.getResourceName(),
                        uidCodec.encode(AgentMetaEnum.DIG_EMPLOYEE, member.getMemObjId())));
                }
            }
        }
        return roster;
    }
}
