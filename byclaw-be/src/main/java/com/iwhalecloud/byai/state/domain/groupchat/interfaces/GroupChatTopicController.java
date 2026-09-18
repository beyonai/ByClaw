package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicQueryService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTopicListResponse;

/** 群成员可见的话题列表，详情查询留待后续实现。 */
@RestController
@RequestMapping("/group-chats/{sessionId}/topics")
public class GroupChatTopicController {
    private final GroupChatTopicQueryService topicQueryService;

    public GroupChatTopicController(GroupChatTopicQueryService topicQueryService) {
        this.topicQueryService = topicQueryService;
    }

    @GetMapping
    public ResponseUtil<GroupChatTopicListResponse> list(@PathVariable Long sessionId,
        @RequestParam(required = false) Integer limit, @RequestParam(required = false) String cursor) {
        return ResponseUtil.successResponse(topicQueryService.list(sessionId, limit, cursor));
    }
}
