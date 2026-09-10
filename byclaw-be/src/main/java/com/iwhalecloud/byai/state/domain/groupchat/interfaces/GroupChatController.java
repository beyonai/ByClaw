package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatDetailResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberRequest;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.groupchat.dto.DirectSessionCreateRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;

/** 群聊资源接口。 */
@RestController
@RequestMapping("/group-chats")
public class GroupChatController {
    private final GroupChatApplicationService applicationService;
    private final GroupChatContextService contextService;
    private final GroupChatTaskService taskService;

    public GroupChatController(GroupChatApplicationService applicationService, GroupChatContextService contextService,
        GroupChatTaskService taskService) {
        this.applicationService = applicationService;
        this.contextService = contextService;
        this.taskService = taskService;
    }

    @org.springframework.web.bind.annotation.GetMapping("/{sessionId}/tasks")
    public ResponseUtil<java.util.List<ByaiGroupChatTask>> tasks(
        @org.springframework.web.bind.annotation.PathVariable Long sessionId) {
        return ResponseUtil.successResponse(taskService.list(sessionId));
    }

    @PostMapping("/{sessionId}/context")
    public ResponseUtil<GroupChatContextResponse> context(
        @org.springframework.web.bind.annotation.PathVariable Long sessionId,
        @RequestBody GroupChatContextRequest request) {
        request.setConversationKey(String.valueOf(sessionId));
        return ResponseUtil.successResponse(contextService.load(request));
    }

    @org.springframework.web.bind.annotation.GetMapping("/{sessionId}")
    public ResponseUtil<GroupChatDetailResponse> detail(
        @org.springframework.web.bind.annotation.PathVariable Long sessionId) {
        return ResponseUtil.successResponse(applicationService.detail(sessionId));
    }

    @PostMapping
    public ResponseUtil<GroupChatDetailResponse> create(@Valid @RequestBody GroupChatCreateRequest request) {
        return ResponseUtil.successResponse(applicationService.create(request));
    }

    @PostMapping("/{sessionId}/members")
    public ResponseUtil<ByaiSessionMember> invite(@org.springframework.web.bind.annotation.PathVariable Long sessionId,
        @Valid @RequestBody GroupChatMemberRequest request) {
        return ResponseUtil.successResponse(applicationService.invite(sessionId, request.getType(), request.getId()));
    }

    @org.springframework.web.bind.annotation.DeleteMapping("/{sessionId}/members/{type}/{id}")
    public ResponseUtil<Void> remove(@org.springframework.web.bind.annotation.PathVariable Long sessionId,
        @org.springframework.web.bind.annotation.PathVariable String type,
        @org.springframework.web.bind.annotation.PathVariable Long id) {
        applicationService.remove(sessionId, type, id);
        return ResponseUtil.successResponse(null);
    }

    @PostMapping("/{sessionId}/members/{type}/{id}/role")
    public ResponseUtil<Void> changeRole(@org.springframework.web.bind.annotation.PathVariable Long sessionId,
        @org.springframework.web.bind.annotation.PathVariable String type,
        @org.springframework.web.bind.annotation.PathVariable Long id,
        @RequestBody java.util.Map<String, String> body) {
        applicationService.changeRole(sessionId, type, id, body == null ? null : body.get("role"));
        return ResponseUtil.successResponse(null);
    }

    @PostMapping("/{sessionId}/transfer-ownership")
    public ResponseUtil<Void> transferOwnership(@org.springframework.web.bind.annotation.PathVariable Long sessionId,
        @RequestBody java.util.Map<String, Long> body) {
        applicationService.transferOwnership(sessionId, body == null ? null : body.get("userId"));
        return ResponseUtil.successResponse(null);
    }

    @PostMapping("/{sessionId}/leave")
    public ResponseUtil<Void> leave(@org.springframework.web.bind.annotation.PathVariable Long sessionId) {
        applicationService.leave(sessionId);
        return ResponseUtil.successResponse(null);
    }

    @PostMapping("/{sessionId}/direct-sessions")
    public ResponseUtil<ByaiSession> directSession(
        @org.springframework.web.bind.annotation.PathVariable Long sessionId,
        @Valid @RequestBody DirectSessionCreateRequest request) {
        return ResponseUtil.successResponse(applicationService.createDirectSession(sessionId, request.getAgentId()));
    }
}
