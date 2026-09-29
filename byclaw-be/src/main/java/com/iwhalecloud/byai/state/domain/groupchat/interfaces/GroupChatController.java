package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMessageRecallService;

import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupWorkAssistantService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupWorkAssistantResponse;

import jakarta.validation.Valid;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberRequest;
import jakarta.servlet.http.HttpServletResponse;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatInvitationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatInvitationTokenRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatInvitationTokenResponse;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMessageAckService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMessageSearchService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMessageSearchRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMessageSearchResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.DirectSessionCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatDetailResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatReadStateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatReadStateResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTransferOwnershipRequest;

import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatInvitationResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatNicknameRequest;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatSettingsService;

/** 群聊资源接口。 */
@RestController
@RequestMapping("/group-chats")
public class GroupChatController {
    @Autowired
    private GroupChatSettingsService settingsService;
    @Autowired
    private GroupChatInvitationService invitationService;
    private final GroupChatApplicationService applicationService;
    private final GroupChatContextService contextService;
    private final GroupChatTaskService taskService;
    private final GroupChatReadService readService;
    private final GroupChatMessageAckService ackService;
    @Autowired
    private GroupChatMessageSearchService messageSearchService;
    @Autowired
    private GroupChatMessageRecallService recallService;
    @Autowired
    private GroupWorkAssistantService groupWorkAssistantService;

    /** 只改变原消息的展示状态，重复请求保持首次撤回事实。 */
    @PostMapping("/{sessionId}/messages/{messageId}/recall")
    public ResponseUtil<JSONObject> recall(@PathVariable Long sessionId, @PathVariable Long messageId) {
        return ResponseUtil.successResponse(recallService.recall(sessionId, messageId));
    }

    @GetMapping("/default-assistant")
    public ResponseUtil<List<GroupWorkAssistantResponse>> defaultAssistant() {
        return ResponseUtil.successResponse(groupWorkAssistantService.getDefaultAssistants());
    }

    @Autowired
    public GroupChatController(GroupChatApplicationService applicationService, GroupChatContextService contextService,
        GroupChatTaskService taskService, GroupChatReadService readService, GroupChatMessageAckService ackService) {
        this.applicationService = applicationService;
        this.contextService = contextService;
        this.taskService = taskService;
        this.readService = readService;
        this.ackService = ackService;
    }

    /** 保留旧测试和嵌入式调用方的构造签名。 */
    public GroupChatController(GroupChatApplicationService applicationService, GroupChatContextService contextService,
        GroupChatTaskService taskService, GroupChatReadService readService) {
        this(applicationService, contextService, taskService, readService, null);
    }

    /** 更新原消息的“收到”状态，不发送新的群消息。 */
    @PostMapping("/{sessionId}/messages/{messageId}/ack")
    public ResponseUtil<com.alibaba.fastjson.JSONObject> acknowledge(
        @PathVariable Long sessionId, @PathVariable Long messageId) {
        if (ackService == null) throw new IllegalStateException("Group message acknowledgement is unavailable");
        return ResponseUtil.successResponse(ackService.acknowledge(sessionId, messageId));
    }

    /** 撤销当前用户对原消息的“收到”状态。 */
    @DeleteMapping("/{sessionId}/messages/{messageId}/ack")
    public ResponseUtil<com.alibaba.fastjson.JSONObject> unacknowledge(
        @PathVariable Long sessionId, @PathVariable Long messageId) {
        if (ackService == null) throw new IllegalStateException("Group message acknowledgement is unavailable");
        return ResponseUtil.successResponse(ackService.unacknowledge(sessionId, messageId));
    }

    /** 按当前 USER 成员关系返回群列表及未读 mention 状态。 */
    @GetMapping
    public ResponseUtil<PageInfo<GroupChatListItemResponse>> list(
        @RequestParam(defaultValue = "1") Integer pageNum,
        @RequestParam(defaultValue = "20") Integer pageSize) {
        return ResponseUtil.successResponse(readService.listMyGroups(pageNum, pageSize));
    }

    /** 只把前端已实际展示的群消息推进为已读位置。 */
    @PutMapping("/{sessionId}/read-state")
    public ResponseUtil<GroupChatReadStateResponse> markRead(
        @PathVariable Long sessionId,
        @Valid @RequestBody GroupChatReadStateRequest request) {
        return ResponseUtil.successResponse(readService.markRead(sessionId, request.getLastReadMessageId()));
    }

    @GetMapping("/{sessionId}/tasks")
    public ResponseUtil<List<ByaiGroupChatTask>> tasks(@PathVariable Long sessionId) {
        return ResponseUtil.successResponse(taskService.list(sessionId));
    }

    @PostMapping("/{sessionId}/context")
    public ResponseUtil<GroupChatContextResponse> context(@PathVariable Long sessionId,
        @RequestBody GroupChatContextRequest request) {
        request.setConversationKey(String.valueOf(sessionId));
        return ResponseUtil.successResponse(contextService.loadTimeline(request));
    }

    @PostMapping("/{sessionId}/messages/search")
    public ResponseUtil<GroupChatMessageSearchResponse> searchMessages(@PathVariable Long sessionId,
        @RequestBody(required = false) GroupChatMessageSearchRequest request) {
        return ResponseUtil.successResponse(messageSearchService.search(sessionId, request));
    }

    @GetMapping("/{sessionId}/messages/{messageId}/context")
    public ResponseUtil<GroupChatContextResponse> messageContext(@PathVariable Long sessionId,
        @PathVariable Long messageId) {
        return ResponseUtil.successResponse(messageSearchService.around(sessionId, messageId));
    }

    @GetMapping("/{sessionId}")
    public ResponseUtil<GroupChatDetailResponse> detail(@PathVariable Long sessionId) {
        return ResponseUtil.successResponse(applicationService.detail(sessionId));
    }

    @PostMapping
    public ResponseUtil<GroupChatDetailResponse> create(@Valid @RequestBody GroupChatCreateRequest request) {
        return ResponseUtil.successResponse(applicationService.create(request));
    }

    @PostMapping("/{sessionId}/members")
    public ResponseUtil<List<ByaiSessionMember>> invite(@PathVariable Long sessionId,
        @Valid @RequestBody GroupChatMemberRequest request) {
        return ResponseUtil.successResponse(applicationService.inviteBatch(sessionId, request.getType(), request.getId()));
    }

    @PostMapping("/{sessionId}/invitations")
    public ResponseUtil<GroupChatInvitationTokenResponse> createInvitation(
        @PathVariable Long sessionId, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ResponseUtil.successResponse(invitationService.create(sessionId));
    }

    @PostMapping("/invitations/validate")
    public ResponseUtil<GroupChatInvitationResponse> validateInvitation(
        @Valid @RequestBody GroupChatInvitationTokenRequest request,
        HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ResponseUtil.successResponse(invitationService.preview(request.getToken()));
    }

    @PostMapping("/invitations/join")
    public ResponseUtil<ByaiSessionMember> joinInvitation(
        @Valid @RequestBody GroupChatInvitationTokenRequest request) {
        Long sessionId = invitationService.resolveSessionId(request.getToken());
        return ResponseUtil.successResponse(applicationService.acceptInvitation(sessionId, request.getToken()));
    }

    @GetMapping("/{sessionId}/settings")
    public ResponseUtil<GroupChatSettingsResponse> settings(@PathVariable Long sessionId) {
        return ResponseUtil.successResponse(settingsService.settings(sessionId));
    }

    @PutMapping("/{sessionId}/settings")
    public ResponseUtil<ByaiSession> updateSettings(@PathVariable Long sessionId,
        @Valid @RequestBody GroupChatSettingsRequest body) {
        return ResponseUtil.successResponse(settingsService.updateSettings(sessionId, body));
    }

    @PutMapping("/{sessionId}/members/me/nickname")
    public ResponseUtil<ByaiSessionMember> nickname(@PathVariable Long sessionId,
        @Valid @RequestBody GroupChatNicknameRequest request) {
        return ResponseUtil.successResponse(settingsService.updateNickname(sessionId, request.getNickname()));
    }

    @GetMapping("/{sessionId}/lifecycle")
    public ResponseUtil<Map<String, Boolean>> lifecycle(@PathVariable Long sessionId) {
        return ResponseUtil.successResponse(Map.of("dissolved", settingsService.isDissolved(sessionId)));
    }

    @PostMapping("/{sessionId}/dissolution-acknowledgment")
    public ResponseUtil<Void> acknowledgeDissolution(@PathVariable Long sessionId) {
        settingsService.acknowledgeDissolution(sessionId);
        return ResponseUtil.successResponse(null);
    }

    @DeleteMapping("/{sessionId}")
    public ResponseUtil<Void> dissolve(@PathVariable Long sessionId) {
        settingsService.dissolve(sessionId);
        return ResponseUtil.successResponse(null);
    }

    @DeleteMapping("/{sessionId}/members/{type}/{id}")
    public ResponseUtil<Void> remove(@PathVariable Long sessionId, @PathVariable String type, @PathVariable Long id) {
        applicationService.remove(sessionId, type, id);
        return ResponseUtil.successResponse(null);
    }

    @PostMapping("/{sessionId}/members/{type}/{id}/role")
    public ResponseUtil<Void> changeRole(@PathVariable Long sessionId, @PathVariable String type,
        @PathVariable Long id, @RequestBody Map<String, String> body) {
        applicationService.changeRole(sessionId, type, id, body == null ? null : body.get("role"));
        return ResponseUtil.successResponse(null);
    }

    @PostMapping("/{sessionId}/transfer-ownership")
    public ResponseUtil<Void> transferOwnership(@PathVariable Long sessionId,
        @Valid @RequestBody GroupChatTransferOwnershipRequest request) {
        applicationService.transferOwnership(sessionId, request.getUserId());
        return ResponseUtil.successResponse(null);
    }

    @PostMapping("/{sessionId}/leave")
    public ResponseUtil<Void> leave(@PathVariable Long sessionId) {
        applicationService.leave(sessionId);
        return ResponseUtil.successResponse(null);
    }

    @PostMapping("/{sessionId}/direct-sessions")
    public ResponseUtil<ByaiSession> directSession(@PathVariable Long sessionId,
        @Valid @RequestBody DirectSessionCreateRequest request) {
        return ResponseUtil.successResponse(applicationService.createDirectSession(sessionId, request.getAgentId()));
    }
}
