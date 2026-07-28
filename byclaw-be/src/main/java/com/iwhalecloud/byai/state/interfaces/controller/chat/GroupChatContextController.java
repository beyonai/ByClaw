package com.iwhalecloud.byai.state.interfaces.controller.chat;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;

/**
 * Super Worker 回源读取群聊历史的内部接口；沿用 Beyond-Token 登录拦截器。
 */
@RestController
@RequestMapping("/internal/api/v1/group-chat")
public class GroupChatContextController {

    private final GroupChatContextService groupChatContextService;

    public GroupChatContextController(GroupChatContextService groupChatContextService) {
        this.groupChatContextService = groupChatContextService;
    }

    @PostMapping("/context")
    public ResponseUtil<GroupChatContextResponse> load(@RequestBody GroupChatContextRequest request) {
        return ResponseUtil.successResponse(groupChatContextService.load(request));
    }
}
