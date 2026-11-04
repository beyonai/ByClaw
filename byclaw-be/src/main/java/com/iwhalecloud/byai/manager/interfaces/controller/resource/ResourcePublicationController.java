package com.iwhalecloud.byai.manager.interfaces.controller.resource;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.application.service.resource.ResourcePublicationAccess;
import com.iwhalecloud.byai.manager.application.service.resource.ResourcePublicationService;
import com.iwhalecloud.byai.manager.application.service.resource.ResourcePublicationService.Command;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController @RequiredArgsConstructor
@RequestMapping("/resourcePublication")
public class ResourcePublicationController {
    private final ResourcePublicationService service;
    private final ResourcePublicationAccess access;

    @GetMapping("/scopeOptions") public ResponseUtil<?> options() {
        return ResponseUtil.successResponse(access.organizationMap().values().stream().map(o -> Map.of(
            "orgId", o.getOrgId().toString(), "orgName", o.getOrgName(),
            "parentOrgId", String.valueOf(o.getParentOrgId()))).toList());
    }
    @GetMapping("/capabilities") public ResponseUtil<?> capabilities() {
        return ResponseUtil.successResponse(Map.of("enabled", true, "administrator", access.administrator(), "reviewer", !access.reviewOrgIds().isEmpty()));
    }
    @GetMapping("/detail") public ResponseUtil<?> detail(@RequestParam Long requestId) { return ResponseUtil.successResponse(service.detail(requestId)); }
    @GetMapping("/current") public ResponseUtil<?> current(@RequestParam Long resourceId) { return ResponseUtil.successResponse(service.current(resourceId)); }
    @GetMapping("/list") public ResponseUtil<?> list(@RequestParam(defaultValue = "false") boolean review,
        @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size,
        @RequestParam(required = false) java.util.List<String> resourceBizTypeList) { return ResponseUtil.successResponse(service.list(review, page, size, resourceBizTypeList)); }
    @GetMapping("/pendingCounts") public ResponseUtil<?> counts() { return ResponseUtil.successResponse(service.pendingCounts()); }
    @GetMapping("/pendingCount") public ResponseUtil<?> count() { return ResponseUtil.successResponse(service.pendingCount()); }
    @PostMapping("/prepare") public ResponseUtil<?> prepare(@RequestBody Command command) { return ResponseUtil.successResponse(service.prepare(command)); }
    @PostMapping("/save") public ResponseUtil<?> save(@RequestBody Command command) { return ResponseUtil.successResponse(service.save(command)); }
    @PostMapping("/submit") public ResponseUtil<?> submit(@RequestBody Command command) { return ResponseUtil.successResponse(service.submit(command)); }
    @PostMapping("/review") public ResponseUtil<?> review(@RequestBody Command command) { return ResponseUtil.successResponse(service.review(command)); }
    @PostMapping("/withdraw") public ResponseUtil<?> withdraw(@RequestBody Command command) { return ResponseUtil.successResponse(service.withdraw(command)); }
    @PostMapping("/retract") public ResponseUtil<?> retract(@RequestBody Command command) { return ResponseUtil.successResponse(service.retract(command)); }
    @ExceptionHandler(BaseException.class) public ResponseEntity<ResponseUtil<Object>> invalid(BaseException error) {
        return ResponseEntity.badRequest().body(ResponseUtil.fail(error.getMessage()));
    }
}
