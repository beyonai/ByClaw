package com.iwhalecloud.byai.manager.interfaces.controller.digitemploy;

/**
 * @author qin.guoquan
 * @date 2026-09-27 22:38:38
 */

import com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationApplicationService.Detail;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeePublicationRequest;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/digitalEmployeePublication")
public class EmployeePublicationController {
    private final EmployeePublicationApplicationService publication;

    /** 发布业务校验应展示具体原因，不能按服务器故障返回 500。 */
    @ExceptionHandler(com.iwhalecloud.byai.common.exception.BaseException.class)
    public org.springframework.http.ResponseEntity<ResponseUtil<Object>> validationFailure(
        com.iwhalecloud.byai.common.exception.BaseException error) {
        return org.springframework.http.ResponseEntity.badRequest().body(ResponseUtil.fail(error.getMessage()));
    }

    @GetMapping("/capabilities")
    public ResponseUtil<Map<String, Boolean>> capabilities() { return ResponseUtil.successResponse(publication.capabilities()); }

    @GetMapping("/pendingCount")
    public ResponseUtil<Long> pendingCount() { return ResponseUtil.successResponse(publication.pendingCount()); }

    @GetMapping("/list")
    public ResponseUtil<EmployeePublicationApplicationService.Page> list(@RequestParam(defaultValue = "false") boolean review,
        @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size) {
        return ResponseUtil.successResponse(publication.list(review, page, size));
    }

    @GetMapping("/detail")
    public ResponseUtil<Detail> detail(@RequestParam Long requestId) { return ResponseUtil.successResponse(publication.detail(requestId)); }

    @GetMapping("/current")
    public ResponseUtil<Detail> current(@RequestParam Long resourceId) { return ResponseUtil.successResponse(publication.current(resourceId)); }

    @GetMapping("/skillSnapshot")
    public void skillSnapshot(@RequestParam Long requestId, @RequestParam Long resourceId,
        jakarta.servlet.http.HttpServletResponse response) throws java.io.IOException {
        try (java.io.InputStream input = publication.skillSnapshot(requestId, resourceId)) {
            if (input == null) throw new com.iwhalecloud.byai.common.exception.BaseException("技能快照文件不存在");
            response.setContentType("application/zip");
            response.setHeader("Content-Disposition", "attachment; filename=skill-" + resourceId + ".zip");
            input.transferTo(response.getOutputStream());
        }
    }

    @PostMapping("/prepare")
    public ResponseUtil<Detail> prepare(@RequestBody EmployeeIdDTO request) { return ResponseUtil.successResponse(publication.prepare(request.getResourceId())); }

    @PostMapping("/prepareUpdate")
    public ResponseUtil<Detail> prepareUpdate(@RequestBody EmployeeIdDTO request) { return ResponseUtil.successResponse(publication.prepareUpdate(request.getResourceId())); }

    @PostMapping("/refreshTarget")
    public ResponseUtil<Detail> refreshTarget(@Valid @RequestBody EmployeePublicationRequest request) { return ResponseUtil.successResponse(publication.refreshTarget(request)); }

    @PostMapping("/preview")
    public ResponseUtil<Detail> preview(@Valid @RequestBody EmployeePublicationRequest request) { return ResponseUtil.successResponse(publication.preview(request)); }

    @PostMapping("/revise")
    public ResponseUtil<Detail> revise(@Valid @RequestBody EmployeePublicationRequest request) { return ResponseUtil.successResponse(publication.revise(request)); }

    @PostMapping("/save")
    public ResponseUtil<Detail> save(@Valid @RequestBody EmployeePublicationRequest request) { return ResponseUtil.successResponse(publication.save(request)); }

    @PostMapping("/submit")
    public ResponseUtil<Detail> submit(@Valid @RequestBody EmployeePublicationRequest request) { return ResponseUtil.successResponse(publication.submit(request)); }

    @PostMapping("/approve")
    public ResponseUtil<Detail> approve(@Valid @RequestBody EmployeePublicationRequest request) { return ResponseUtil.successResponse(publication.approve(request)); }

    @PostMapping("/reject")
    public ResponseUtil<Detail> reject(@Valid @RequestBody EmployeePublicationRequest request) { return ResponseUtil.successResponse(publication.reject(request)); }

    @PostMapping("/withdraw")
    public ResponseUtil<Detail> withdraw(@Valid @RequestBody EmployeePublicationRequest request) { return ResponseUtil.successResponse(publication.withdraw(request)); }
}
