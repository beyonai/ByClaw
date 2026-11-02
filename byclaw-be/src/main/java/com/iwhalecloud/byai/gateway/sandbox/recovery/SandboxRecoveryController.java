package com.iwhalecloud.byai.gateway.sandbox.recovery;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.Map;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** All records can contain cross-user conversation content; never rely on a hidden UI tab for authorization. */
@RestController
@RequestMapping("/sandbox/recovery")
public class SandboxRecoveryController {
    private final SandboxRecoveryStore store;
    private final SandboxRecoveryService service;
    private final ByaiSystemConfigService systemConfigService;
    public SandboxRecoveryController(SandboxRecoveryStore store, SandboxRecoveryService service, ByaiSystemConfigService systemConfigService) {
        this.store = store; this.service = service; this.systemConfigService = systemConfigService;
    }
    private void guard() {
        if (!CurrentUserHolder.isAdminVip() || !"openSource".equals(systemConfigService.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "仅开源版本的 adminvip 可处理恢复任务");
    }
    @PostMapping("/queues")
    public ResponseUtil<?> queues(@RequestBody Map<String, String> query) {
        guard();
        return respond(() -> store.queues(query.getOrDefault("cursor", "0")));
    }
    @PostMapping("/messages")
    public ResponseUtil<?> messages(@RequestBody Map<String, String> query) {
        guard();
        return respond(() -> service.messages(query.get("stream"), query.getOrDefault("group", ""),
            query.getOrDefault("state", "PENDING"), query.get("cursor")));
    }
    @PostMapping("/action")
    public ResponseUtil<?> action(@RequestBody SandboxRecoveryService.Action action) {
        guard();
        return respond(() -> service.act(action));
    }
    @PostMapping("/history")
    public ResponseUtil<?> history() {
        guard();
        return respond(store::history);
    }
    private ResponseUtil<?> respond(java.util.function.Supplier<?> call) {
        try { return ResponseUtil.successResponse(call.get()); }
        catch (IllegalArgumentException failure) { return ResponseUtil.fail(SandboxRecoveryService.safe(failure.getMessage(), 500)); }
        catch (RuntimeException failure) {
            return ResponseUtil.fail("恢复队列操作失败，请检查 Redis / 沙箱服务日志；本次不能确认操作成功");
        }
    }
}
