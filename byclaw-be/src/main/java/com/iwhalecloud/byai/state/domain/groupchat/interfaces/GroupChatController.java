package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import java.util.List;
import java.util.Map;

import jakarta.validation.Valid;

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
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.DirectSessionCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatDetailResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatReadStateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatReadStateResponse;

/** 群聊资源接口。 */
@RestController
@RequestMapping("/group-chats")
public class GroupChatController {
    private final GroupChatApplicationService applicationService;
    private final GroupChatContextService contextService;
    private final GroupChatTaskService taskService;
    private final GroupChatReadService readService;

    public GroupChatController(GroupChatApplicationService applicationService, GroupChatContextService contextService,
        GroupChatTaskService taskService, GroupChatReadService readService) {
        this.applicationService = applicationService;
        this.contextService = contextService;
        this.taskService = taskService;
        this.readService = readService;
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
        return ResponseUtil.successResponse(contextService.load(request));
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
    public ResponseUtil<ByaiSessionMember> invite(@PathVariable Long sessionId,
        @Valid @RequestBody GroupChatMemberRequest request) {
        return ResponseUtil.successResponse(applicationService.invite(sessionId, request.getType(), request.getId()));
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
    public ResponseUtil<Void> transferOwnership(@PathVariable Long sessionId, @RequestBody Map<String, Long> body) {
        applicationService.transferOwnership(sessionId, body == null ? null : body.get("userId"));
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
