package com.iwhalecloud.byai.manager.interfaces.controller.auth;

import com.iwhalecloud.byai.manager.application.service.auth.AuthorizationTaskService;
import com.iwhalecloud.byai.manager.entity.auth.AuthorizationTask;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.auth.AuthorizationTaskQo;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth/privilegeGrant/tasks")
public class AuthorizationTaskController {
    @Autowired private AuthorizationTaskService tasks;

    @PostMapping public ResponseUtil<AuthorizationTask> submit(@Validated @RequestBody AuthorizationTaskQo request) {
        return ResponseUtil.successResponse(tasks.submit(request));
    }
    @GetMapping("/{id}") public ResponseUtil<AuthorizationTask> get(@PathVariable String id) {
        return ResponseUtil.successResponse(tasks.get(id));
    }
    @GetMapping public ResponseUtil<List<AuthorizationTask>> latest(@RequestParam Long resourceId) {
        return ResponseUtil.successResponse(tasks.latest(resourceId));
    }
    @GetMapping("/by-request") public ResponseUtil<AuthorizationTask> findRequest(
        @RequestParam Long resourceId, @RequestParam String requestId) {
        return ResponseUtil.successResponse(tasks.findRequest(resourceId, requestId));
    }
    @PostMapping("/{id}/retry") public ResponseUtil<AuthorizationTask> retry(@PathVariable String id) {
        return ResponseUtil.successResponse(tasks.retry(id));
    }
    @PostMapping("/{id}/cancel") public ResponseUtil<AuthorizationTask> cancel(@PathVariable String id) {
        return ResponseUtil.successResponse(tasks.cancel(id));
    }
}
