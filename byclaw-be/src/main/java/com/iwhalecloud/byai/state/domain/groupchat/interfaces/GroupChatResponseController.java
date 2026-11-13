package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import java.util.List;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatResponseQueryService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 群响应状态与发起人流绑定接口；创建者 Codex，2026-11-13。 */
@RestController
@RequestMapping("/group-chats/{groupId}/responses")
public class GroupChatResponseController {
    @Autowired
    private GroupChatResponseQueryService queryService;


    @GetMapping("")
    public ResponseUtil<JSONObject> list(@PathVariable Long groupId,
        @RequestParam(required = false) String cursor, @RequestParam(defaultValue = "50") int limit,
        HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ResponseUtil.successResponse(queryService.list(groupId, cursor, limit));
    }

    @PostMapping("/resolve")
    public ResponseUtil<JSONObject> resolve(@PathVariable Long groupId, @Valid @RequestBody ResolveRequest request,
        HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        return ResponseUtil.successResponse(queryService.resolve(groupId, request.getResponseIds()));
    }

    @Getter
    @Setter
    public static class ResolveRequest {
        @NotNull
        @Size(max = 100)
        private List<String> responseIds;
    }
}
