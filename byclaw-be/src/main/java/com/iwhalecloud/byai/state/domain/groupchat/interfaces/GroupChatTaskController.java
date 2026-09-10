package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskCompleteRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskPublicationResponse;

/** 群聊任务私有详情、完成发布及取消接口。 */
@RestController
@RequestMapping("/group-chat/tasks")
public class GroupChatTaskController {
    private final GroupChatTaskService taskService;

    public GroupChatTaskController(GroupChatTaskService taskService) {
        this.taskService = taskService;
    }

    @GetMapping("/{taskId}")
    public ResponseUtil<ByaiGroupChatTask> detail(@PathVariable Long taskId) {
        return ResponseUtil.successResponse(taskService.detail(taskId));
    }

    @PostMapping("/{taskId}/complete")
    public ResponseUtil<GroupChatTaskPublicationResponse> complete(@PathVariable Long taskId,
        @Valid @RequestBody GroupChatTaskCompleteRequest request) {
        return ResponseUtil.successResponse(taskService.complete(taskId, request));
    }

    @PostMapping("/{taskId}/cancel")
    public ResponseUtil<Void> cancel(@PathVariable Long taskId) {
        taskService.cancel(taskId);
        return ResponseUtil.successResponse(null);
    }
}
