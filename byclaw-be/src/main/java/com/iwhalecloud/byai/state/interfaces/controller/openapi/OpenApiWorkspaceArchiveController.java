package com.iwhalecloud.byai.state.interfaces.controller.openapi;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.session.WorkspaceArchiveApplicationService;
import com.iwhalecloud.byai.state.domain.session.dto.WorkspaceArchiveDto;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
@RequestMapping("/open/api/inner/v1/workspace-archive")
@Tag(name = "内部 workspace 归档接口", description = "内部 workspace 归档接口")
public class OpenApiWorkspaceArchiveController {


    @Autowired
    private WorkspaceArchiveApplicationService workspaceArchiveApplicationService;

    @PostMapping(value = "/dig-employees/{resourceId}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<WorkspaceArchiveDto> upload(
        @PathVariable("resourceId") Long resourceId,
        @RequestParam("userCode") String userCode,
        @RequestParam(value = "archiveKind", defaultValue = "cancel_auth") String archiveKind,
        @RequestParam("file") MultipartFile file,
        @RequestParam(value = "sha256", required = false) String sha256) {
        try {
            return ResponseUtil.successResponse(
                workspaceArchiveApplicationService.upload(userCode, resourceId, archiveKind, file, sha256));
        }
        catch (Exception e) {
            log.error("workspace archive上传接口失败, userCode={}, resourceId={}, archiveKind={}", userCode, resourceId,
                archiveKind, e);
            return ResponseUtil.fail("workspace archive上传失败：" + e.getMessage());
        }
    }

    @GetMapping("/dig-employees/{resourceId}/status")
    public ResponseUtil<WorkspaceArchiveDto> status(
        @PathVariable("resourceId") Long resourceId,
        @RequestParam("userCode") String userCode,
        @RequestParam(value = "archiveKind", defaultValue = "cancel_auth") String archiveKind) {
        try {
            return ResponseUtil.successResponse(workspaceArchiveApplicationService.status(userCode, resourceId,
                archiveKind));
        }
        catch (Exception e) {
            log.error("workspace archive状态查询接口失败, userCode={}, resourceId={}, archiveKind={}", userCode,
                resourceId, archiveKind, e);
            return ResponseUtil.fail("workspace archive状态查询失败：" + e.getMessage());
        }
    }

    @GetMapping("/dig-employees/{resourceId}")
    public ResponseEntity<StreamingResponseBody> download(
        @PathVariable("resourceId") Long resourceId,
        @RequestParam("userCode") String userCode,
        @RequestParam(value = "archiveKind", defaultValue = "cancel_auth") String archiveKind) {
        try {
            String fileName = workspaceArchiveApplicationService.getArchiveFileName(resourceId, archiveKind);
            String contentDisposition = "attachment; filename=\"" + fileName + "\"";
            return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/gzip"))
                .header("Content-Disposition", contentDisposition)
                .body(workspaceArchiveApplicationService.download(userCode, resourceId, archiveKind));
        }
        catch (Exception e) {
            log.error("workspace archive下载接口失败, userCode={}, resourceId={}, archiveKind={}", userCode, resourceId,
                archiveKind, e);
            String msg = "workspace archive下载失败：" + e.getMessage();
            return ResponseEntity.badRequest()
                .contentType(MediaType.parseMediaType("text/plain; charset=UTF-8"))
                .body(out -> out.write(msg.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
    }

    @DeleteMapping("/dig-employees/{resourceId}")
    public ResponseUtil<WorkspaceArchiveDto> delete(
        @PathVariable("resourceId") Long resourceId,
        @RequestParam("userCode") String userCode,
        @RequestParam(value = "archiveKind", defaultValue = "cancel_auth") String archiveKind) {
        try {
            return ResponseUtil.successResponse(workspaceArchiveApplicationService.delete(userCode, resourceId,
                archiveKind));
        }
        catch (Exception e) {
            log.error("workspace archive删除接口失败, userCode={}, resourceId={}, archiveKind={}", userCode, resourceId,
                archiveKind, e);
            return ResponseUtil.fail("workspace archive删除失败：" + e.getMessage());
        }
    }
}
