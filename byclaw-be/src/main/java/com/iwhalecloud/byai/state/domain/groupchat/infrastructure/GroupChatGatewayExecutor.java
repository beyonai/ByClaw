package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMemberUidCodec;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder.GroupMemberPrompt;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;

/** 将持久化的群聊执行记录投递到独立 Gateway session。 */
@Service
public class GroupChatGatewayExecutor {
    private final GatewayClient gatewayClient;
    private final ByaiMessageMapper messageMapper;
    private final UserService userService;
    private final SsResourceService resourceService;
    private final TargetAgentResolver targetAgentResolver;
    private final GroupChatContextTokenService tokenService;
    private final GroupChatDispatchPromptBuilder promptBuilder;
    private final SessionMemberService memberService;
    private final GroupChatMemberUidCodec uidCodec;

    public GroupChatGatewayExecutor(GatewayClient gatewayClient, ByaiMessageMapper messageMapper,
        UserService userService, SsResourceService resourceService, TargetAgentResolver targetAgentResolver,
        GroupChatContextTokenService tokenService, GroupChatDispatchPromptBuilder promptBuilder,
        SessionMemberService memberService, GroupChatMemberUidCodec uidCodec) {
        this.gatewayClient = gatewayClient;
        this.messageMapper = messageMapper;
        this.userService = userService;
        this.resourceService = resourceService;
        this.targetAgentResolver = targetAgentResolver;
        this.tokenService = tokenService;
        this.promptBuilder = promptBuilder;
        this.memberService = memberService;
        this.uidCodec = uidCodec;
    }

    public GatewayClient.SendResponse execute(ByaiGroupChatExecution execution, String workspace) {
        ByaiMessage source = messageMapper.selectByMessageId(execution.getSourceMessageId());
        Users initiator = userService.findById(execution.getInitiatorUserId());
        SsResource agent = resourceService.findById(execution.getTargetAgentId());
        if (source == null || initiator == null || agent == null) {
            throw new IllegalArgumentException("Group execution resources are unavailable");
        }
        String userCode = initiator.getUserCode();
        String targetType = targetAgentResolver.resolveAgentType(agent.getWorkerAgentType(),
            execution.getTargetAgentId(), null, userCode);
        Map<String, Object> params = new HashMap<>();
        params.put("cwd", workspace);
        params.put("groupSessionId", execution.getGroupSessionId());
        params.put("sourceMessageId", execution.getSourceMessageId());
        params.put("replyToMessageId", execution.getReplyToMessageId());
        params.put("rootMessageId", execution.getRootMessageId());
        params.put("initiatorUserId", execution.getInitiatorUserId());
        params.put("gatewaySessionId", execution.getGatewaySessionId());
        String contextToken = tokenService.issue(execution.getGroupSessionId(), execution.getCandidateSessionId(),
            execution.getInitiatorUserId(), execution.getTargetAgentId(), execution.getSourceMessageId());
        // 候选 session 只承载 Agent 运行历史；群聊上下文仍从原群 session 按来源消息边界读取。
        Map<String, Object> groupChat = new HashMap<>();
        groupChat.put("schemaVersion", "byclaw.group-chat-ref/v1");
        groupChat.put("conversationKey", String.valueOf(execution.getGroupSessionId()));
        groupChat.put("beforeMessageId", String.valueOf(execution.getSourceMessageId()));
        groupChat.put("contextToken", contextToken);
        groupChat.put("childSessionId", execution.getCandidateSessionId());
        groupChat.put("initiatorUserId", execution.getInitiatorUserId());
        groupChat.put("targetAgentId", execution.getTargetAgentId());
        params.put("groupChat", groupChat);
        // Gateway 的群聊文本参数必须保持为 String；传入 JSONObject 会在下游被隐式转换成
        // "[object Object]"，导致 Agent 实际收到的不是用户正文。
        String content = promptBuilder.append(source.getMessageContent(), execution.getExecutionId(),
            execution.getCandidateSessionId(), buildMemberRoster(execution));
        return gatewayClient.sendMessage(targetType, execution.getGatewaySessionId(), content, userCode,
            initiator.getUserName(), "ASK_AGENT", "-1", String.valueOf(execution.getSourceMessageId()),
            execution.getTraceId(), params, Map.of("scene", "GROUP_CHAT"));
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
