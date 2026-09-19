package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import java.util.List;

import jakarta.validation.Valid;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.application.WorkgroupTemplateService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.WorkgroupTemplateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.WorkgroupTemplateResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/workgroup-templates")
public class WorkgroupTemplateController {
    private final WorkgroupTemplateService service;

    public WorkgroupTemplateController(WorkgroupTemplateService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseUtil<List<WorkgroupTemplateResponse>> list(@RequestParam(required = false) String keyword,
        @RequestParam(required = false) Long catalogId) {
        return ResponseUtil.successResponse(service.list(keyword, catalogId, false));
    }

    @GetMapping("/manage-capability")
    public ResponseUtil<Boolean> capability() {
        return ResponseUtil.successResponse(service.canManage());
    }

    @GetMapping("/admin")
    public ResponseUtil<List<WorkgroupTemplateResponse>> adminList() {
        return ResponseUtil.successResponse(service.listForManagement());
    }

    @PostMapping("/admin")
    public ResponseUtil<WorkgroupTemplateResponse> create(@Valid @RequestBody WorkgroupTemplateRequest request) {
        return ResponseUtil.successResponse(service.save(null, request));
    }

    @PutMapping("/admin/{templateId}")
    public ResponseUtil<WorkgroupTemplateResponse> update(@PathVariable Long templateId,
        @Valid @RequestBody WorkgroupTemplateRequest request) {
        return ResponseUtil.successResponse(service.save(templateId, request));
    }

    @DeleteMapping("/admin/{templateId}")
    public ResponseUtil<Void> delete(@PathVariable Long templateId, @RequestParam Long expectedVersion) {
        service.delete(templateId, expectedVersion);
        return ResponseUtil.successResponse();
    }
}
