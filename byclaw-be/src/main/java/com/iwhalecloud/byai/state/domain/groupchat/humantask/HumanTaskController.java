package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.List;
import org.springframework.web.bind.annotation.*;
/** Human-task APIs intentionally keep direct multipart uploads separate from the group composer. */
@RestController
public class HumanTaskController {

    private final HumanTaskService service;

    public HumanTaskController(HumanTaskService service) {
        this.service = service;
    }
    @PostMapping("/group-human-task-batches")

    public ResponseUtil<JSONObject> createDirect(@RequestBody JSONObject b) {
        return ok(service.call("createDirect", b));
    }
    @PostMapping("/group-human-task-proposals")

    public ResponseUtil<JSONObject> create(@RequestBody JSONObject b) {
        return ok(service.call("createProposal", b));
    }
    @GetMapping("/group-human-task-proposals/{id}")

    public ResponseUtil<JSONObject> proposal(@PathVariable Long id) {
        return ok(service.call("proposal", body("batchId", id, null)));
    }
    @PatchMapping("/group-human-task-proposals/{id}")

    public ResponseUtil<JSONObject> update(@PathVariable Long id, @RequestBody JSONObject b) {
        return ok(service.call("updateProposal", body("batchId", id, b)));
    }
    @PostMapping("/group-human-task-proposals/{id}/confirm")

    public ResponseUtil<JSONObject> confirm(@PathVariable Long id, @RequestBody JSONObject b) {
        return ok(service.call("confirm", body("batchId", id, b)));
    }
    @GetMapping("/group-human-task-batches/{id}")

    public ResponseUtil<JSONObject> batch(@PathVariable Long id) {
        return ok(service.call("batch", body("batchId", id, null)));
    }
    @GetMapping("/group-human-tasks")

    public ResponseUtil<JSONObject> list(@RequestParam(defaultValue = "ALL") String relation, @RequestParam(required = false) String status,
    @RequestParam(defaultValue = "1") int pageNum, @RequestParam(defaultValue = "20") int pageSize,
    @RequestParam(name = "view", required = false) String view,
    @RequestParam(name = "groupSessionId", required = false) String groupSessionId) {
        JSONObject b = new JSONObject();
        b.put("relation", relation);
        b.put("status", status);
        b.put("view", view);
        if (groupSessionId != null) {
            b.put("groupSessionId", groupSessionId);
        }
        b.put("pageNum", pageNum);
        b.put("pageSize", pageSize);
        return ok(service.call("list", b));
    }
    /** Returns homepage badge counts for the authenticated user without loading task details. */
    @GetMapping("/group-human-tasks/counts")
    public ResponseUtil<JSONObject> counts(@RequestParam(name = "groupSessionId", required = false) String groupSessionId) {
        JSONObject body = new JSONObject();
        if (groupSessionId != null) {
            body.put("groupSessionId", groupSessionId);
        }
        return ok(service.call("counts", body));
    }

    /** Lists all tasks in a group after checking the caller's current group membership. */
    @GetMapping("/group-chats/{groupSessionId}/human-tasks")
    public ResponseUtil<JSONObject> groupList(@PathVariable("groupSessionId") String groupSessionId,
        @RequestParam(name = "status", required = false) String status,
        @RequestParam(name = "initiatorUserIds", required = false) List<String> initiatorUserIds,
        @RequestParam(name = "assigneeUserIds", required = false) List<String> assigneeUserIds,
        @RequestParam(name = "pageNum", defaultValue = "1") int pageNum,
        @RequestParam(name = "pageSize", defaultValue = "20") int pageSize) {
        JSONObject body = new JSONObject();
        body.put("groupSessionId", groupSessionId);
        body.put("status", status);
        body.put("initiatorUserIds", initiatorUserIds);
        body.put("assigneeUserIds", assigneeUserIds);
        body.put("pageNum", pageNum);
        body.put("pageSize", pageSize);
        return ok(service.call("groupList", body));
    }

    @GetMapping("/group-human-tasks/{id}")

    public ResponseUtil<JSONObject> task(@PathVariable Long id) {
        return ok(service.task(id));
    }
    @GetMapping("/group-human-tasks/{id}/submissions")

    public ResponseUtil<JSONObject> history(@PathVariable Long id) {
        return ok(service.call("history", body("humanTaskId", id, null)));
    }
    @PostMapping("/group-human-tasks/{id}/reviews")

    public ResponseUtil<JSONObject> review(@PathVariable Long id, @RequestBody JSONObject b) {
        return ok(service.call("review", body("humanTaskId", id, b)));
    }
    @PostMapping("/group-human-tasks/{id}/sessions")

    public ResponseUtil<JSONObject> bind(@PathVariable Long id, @RequestBody JSONObject b) {
        return ok(service.call("bind", body("humanTaskId", id, b)));
    }

    private JSONObject body(String key, Long id, JSONObject b) {
        if (b == null)b = new JSONObject();
        b.put(key, id.toString());
        return b;
    }

    private ResponseUtil<JSONObject> ok(JSONObject value) {
        return ResponseUtil.successResponse(value);
    }
}
