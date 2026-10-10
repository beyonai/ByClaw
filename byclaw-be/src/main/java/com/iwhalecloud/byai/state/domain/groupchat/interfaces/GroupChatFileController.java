package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatFileQueryService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatFileListResponse;

/** 当前群成员可见的消息附件列表。 */
@RestController
@RequestMapping("/group-chats/{sessionId}/files")
public class GroupChatFileController {
    private final GroupChatFileQueryService files;

    public GroupChatFileController(GroupChatFileQueryService files) {
        this.files = files;
    }

    @GetMapping
    public ResponseUtil<GroupChatFileListResponse> list(@PathVariable("sessionId") Long sessionId,
        @RequestParam(value = "pageSize", required = false) Integer pageSize,
        @RequestParam(value = "cursor", required = false) String cursor) {
        return ResponseUtil.successResponse(files.list(sessionId, pageSize, cursor));
    }
}
