package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
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

    public GroupChatGatewayExecutor(ScriptService scriptService, ByaiMessageMapper messageMapper,
        UserService userService, SsResourceService resourceService,
        GroupChatContextTokenService tokenService, GroupChatDispatchPromptBuilder promptBuilder,
        SessionMemberService memberService, GroupChatMemberUidCodec uidCodec,
        ByaiGroupChatExecutionMapper executionMapper, SequenceService sequenceService,
        SandboxUserContextRunner userContextRunner) {
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

    @Override
    public Object decorate(ChatProcessContext context, Object content, Map<String, Object> gatewayParams) {
        if (context == null || context.sessionId == null) {
            return content;
        }
        ByaiGroupChatExecution execution = executionMapper.selectByCandidateSessionId(context.sessionId);
        if (execution == null) {
            return content;
        }
        if (!Objects.equals(context.userId, execution.getInitiatorUserId())
            || context.assistantChatDto == null
            || !Objects.equals(context.assistantChatDto.getAgentId(), execution.getTargetAgentId())) {
            throw new IllegalArgumentException("Group candidate runtime identity does not match its dispatch");
        }
        // Subsequent task turns keep the frozen parent boundary but never repeat initial classification.
        Map<String, Object> groupChat = new HashMap<>();
        groupChat.put("schemaVersion", "byclaw.group-chat-ref/v1");
        groupChat.put("conversationKey", String.valueOf(execution.getGroupSessionId()));
        groupChat.put("beforeMessageId", String.valueOf(execution.getSourceMessageId()));
        groupChat.put("contextToken", tokenService.issue(execution.getGroupSessionId(), execution.getCandidateSessionId(),
            execution.getInitiatorUserId(), execution.getTargetAgentId(), execution.getSourceMessageId()));
        groupChat.put("childSessionId", execution.getCandidateSessionId());
        groupChat.put("initiatorUserId", execution.getInitiatorUserId());
        groupChat.put("targetAgentId", execution.getTargetAgentId());
        gatewayParams.put("groupChat", groupChat);
        gatewayParams.put("cwd", "/by/.sessions/" + execution.getCandidateSessionId());
        if (Objects.equals(execution.getTraceId(), context.traceId) && "RUNNING".equals(execution.getStatus())) {
            if (!(content instanceof String)) {
                throw new IllegalArgumentException("Initial group dispatch requires textual content");
            }
            return promptBuilder.append((String) content, execution.getExecutionId(),
                execution.getCandidateSessionId(), buildMemberRoster(execution));
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
