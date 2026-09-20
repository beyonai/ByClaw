package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicMessagesService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicQueryService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTopicListResponse;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTopicMessagesResponse;

/** 群成员可见的话题列表和独立消息分页。 */
@RestController
@RequestMapping("/group-chats/{sessionId}/topics")
public class GroupChatTopicController {
    private final GroupChatTopicQueryService topicQueryService;
    private final GroupChatTopicMessagesService topicMessagesService;

    public GroupChatTopicController(GroupChatTopicQueryService topicQueryService,
        GroupChatTopicMessagesService topicMessagesService) {
        this.topicMessagesService = topicMessagesService;
        this.topicQueryService = topicQueryService;
    }

    @GetMapping("/{topicId}/messages")
    public ResponseUtil<GroupChatTopicMessagesResponse> messages(@PathVariable Long sessionId,
        @PathVariable Long topicId, @RequestParam(required = false) Integer limit,
        @RequestParam(required = false) String cursor) {
        return ResponseUtil.successResponse(topicMessagesService.list(sessionId, topicId, limit, cursor));
    }

    @GetMapping
    public ResponseUtil<GroupChatTopicListResponse> list(@PathVariable Long sessionId,
        @RequestParam(required = false) Integer limit, @RequestParam(required = false) String cursor) {
        return ResponseUtil.successResponse(topicQueryService.list(sessionId, limit, cursor));
    }
}
