package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatGatewayRequestDecorator;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.ScriptService;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMemberUidCodec;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder.GroupMemberPrompt;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** Adapts group dispatch to the ordinary private session runtime and decorates its Gateway request. */
@Service
public class GroupChatGatewayExecutor implements ChatGatewayRequestDecorator {
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
        userContextRunner.runAsUser(prepared.userCode(), () -> {
            try {
                if (prepared.internal()) {
                    scriptService.startExistingMessageTurn(prepared.request(), prepared.message(), true);
                }
                else {
                    scriptService.startExistingMessageTurn(prepared.request(), prepared.message());
                }
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
        ByaiMessage child = messageMapper.selectByMessageId(turn.getInputMessageId());
        if (child == null) {
            child = new ByaiMessage();
            child.setId(turn.getInputMessageId());
            child.setMessageId(turn.getInputMessageId());
            child.setSessionId(runtimeSessionId);
            child.setProjectId(session.getProjectId());
            // Normal runtime authorization uses creatorId; actual message authorship is retained in metadata/input.
            child.setCreatorId(turn.getInitiatorUserId());
            child.setCreatorName(initiator.getUserName());
            child.setMessageContent(turn.getInputContent());
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
            || !Objects.equals(child.getMessageContent(), turn.getInputContent())) {
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
        return new PreparedTurn(dto, existing, initiator.getUserCode(), "ASSESSMENT".equals(turn.getPhase()));
    }

    private record PreparedTurn(AssistantChatDto request, ByaiMessageHotDtoDto message, String userCode,
        boolean internal) {
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
        if (!Objects.equals(context.userId, execution.getInitiatorUserId())
            || context.assistantChatDto == null
            || !Objects.equals(context.assistantChatDto.getAgentId(), execution.getTargetAgentId())) {
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
        if (Objects.equals(execution.getTraceId(), context.traceId) && "RUNNING".equals(execution.getStatus())) {
            if (!(content instanceof String)) {
                throw new IllegalArgumentException("Initial group dispatch requires textual content");
            }
            if (turn != null && "ASSESSMENT".equals(turn.getPhase())) {
                return promptBuilder.appendRoutingAssessment((String) content, turn.getExecutionId(), context.sessionId);
            }
            if (turn != null && "CHAT_CONTINUATION".equals(turn.getPhase())) {
                return promptBuilder.appendChatContinuation((String) content, buildMemberRoster(execution));
            }
            return promptBuilder.append((String) content, execution.getExecutionId(),
                context.sessionId, buildMemberRoster(execution));
        }
        return content;
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
