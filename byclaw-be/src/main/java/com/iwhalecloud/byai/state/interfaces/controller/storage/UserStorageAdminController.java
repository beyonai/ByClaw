package com.iwhalecloud.byai.state.interfaces.controller.storage;

import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageDowngradeApplicationService;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageQuotaApplicationService;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageRecycleApplicationService;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageDowngradeCommand;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageDowngradeQuery;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageGrantQuery;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageQuotaQuery;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageRecycleQuery;
import com.iwhalecloud.byai.manager.entity.storage.StoragePackageEntity;
import com.iwhalecloud.byai.manager.entity.storage.StorageQuotaSetting;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

@RestController
@RequestMapping("/storage/admin")
public class UserStorageAdminController {

    @Autowired
    private UserStorageQuotaApplicationService quotaService;

    @Autowired
    private UserStorageRecycleApplicationService recycleService;

    @Autowired
    private UserStorageDowngradeApplicationService downgradeService;

    @GetMapping("/packages")
    public ResponseUtil<?> packages() {
        requireAdmin();
        return ResponseUtil.successResponse(quotaService.listPackages());
    }

    @GetMapping("/settings")
    public ResponseUtil<?> settings() {
        requireAdmin();
        return ResponseUtil.successResponse(quotaService.getSettings());
    }

    @PostMapping("/settings")
    public ResponseUtil<?> updateSettings(@RequestBody StorageQuotaSetting request) {
        requireAdmin();
        return ResponseUtil.successResponse(quotaService.updateSettings(request));
    }

    @PostMapping("/packages/upsert")
    public ResponseUtil<?> upsertPackage(@RequestBody StoragePackageEntity request) {
        requireAdmin();
        return ResponseUtil.successResponse(quotaService.upsertPackage(request));
    }

    @PostMapping("/packages/delete")
    public ResponseUtil<?> deletePackage(@RequestBody Map<String, Object> request) {
        requireAdmin();
        return ResponseUtil.successResponse(quotaService.deletePackage(longValue(request.get("packageId"))));
    }

    @PostMapping("/users/page")
    public ResponseUtil<?> users(@RequestBody(required = false) UserStorageQuotaQuery request) {
        requireAdmin();
        return ResponseUtil.successResponse(quotaService.listQuotaPage(request));
    }

    @PostMapping("/grants/page")
    public ResponseUtil<?> activeGrants(@RequestBody(required = false) UserStorageGrantQuery request) {
        requireAdmin();
        return ResponseUtil.successResponse(quotaService.listActiveGrantPage(request));
    }

    @PostMapping("/users/grant")
    public ResponseUtil<?> grant(@RequestBody Map<String, Object> request) {
        requireAdmin();
        return ResponseUtil.successResponse(downgradeService.adminAddPackage(longValue(request.get("userId")),
            longValue(request.get("packageId")), request.get("remark") == null ? null : String.valueOf(request.get("remark"))));
    }

    @PostMapping("/users/revoke")
    public ResponseUtil<?> revoke(@RequestBody Map<String, Object> request) {
        requireAdmin();
        UserStorageDowngradeCommand command = new UserStorageDowngradeCommand();
        command.setGrantId(longValue(request.get("grantId")));
        command.setReason(request.get("remark") == null
            ? "管理员取消增值包" : String.valueOf(request.get("remark")));
        return ResponseUtil.successResponse(downgradeService.adminCancelGrant(command));
    }

    @PostMapping("/grants/cancel/preview")
    public ResponseUtil<?> previewGrantCancellation(@RequestBody UserStorageDowngradeCommand command) {
        requireAdmin();
        return ResponseUtil.successResponse(command.getGrantIds() == null || command.getGrantIds().isEmpty()
            ? downgradeService.previewCancellation(command.getGrantId(), null)
            : downgradeService.previewCancellation(command.getGrantIds(), null));
    }

    @PostMapping("/grants/cancel")
    public ResponseUtil<?> cancelGrant(@RequestBody UserStorageDowngradeCommand command) {
        requireAdmin();
        return ResponseUtil.successResponse(downgradeService.adminCancelGrant(command));
    }

    @PostMapping({"/changes/page", "/cancellations/page"})
    public ResponseUtil<?> cancellationPage(@RequestBody(required = false) UserStorageDowngradeQuery request) {
        requireAdmin();
        return ResponseUtil.successResponse(downgradeService.listAdminPage(request));
    }

    @PostMapping({"/changes/approve", "/cancellations/approve"})
    public ResponseUtil<?> approveCancellation(@RequestBody UserStorageDowngradeCommand command) {
        requireAdmin();
        return ResponseUtil.successResponse(downgradeService.approveChange(command));
    }

    @PostMapping({"/changes/reject", "/cancellations/reject"})
    public ResponseUtil<?> rejectCancellation(@RequestBody UserStorageDowngradeCommand command) {
        requireAdmin();
        return ResponseUtil.successResponse(downgradeService.rejectChange(command));
    }

    @PostMapping("/users/reset")
    public ResponseUtil<?> reset(@RequestBody Map<String, Object> request) {
        requireAdmin();
        return ResponseUtil.successResponse(recycleService.reset(longValue(request.get("userId")),
            request.get("requestId") == null ? null : String.valueOf(request.get("requestId"))));
    }

    @PostMapping("/users/restore")
    public ResponseUtil<?> restore(@RequestBody Map<String, Object> request) {
        requireAdmin();
        return ResponseUtil.successResponse(recycleService.restore(longValue(request.get("userId")),
            longValue(request.get("recycleId"))));
    }

    @PostMapping("/users/recycles")
    public ResponseUtil<?> recycles(@RequestBody(required = false) UserStorageRecycleQuery request) {
        requireAdmin();
        return ResponseUtil.successResponse(recycleService.listByUserPage(request));
    }

    @PostMapping("/users/recycles/preview/list")
    public ResponseUtil<?> recyclePreviewFiles(@RequestBody Map<String, Object> request) {
        requireAdmin();
        String path = request.get("path") == null ? "/" : String.valueOf(request.get("path"));
        return ResponseUtil.successResponse(recycleService.listPreviewFiles(longValue(request.get("userId")),
            longValue(request.get("recycleId")), path));
    }

    @GetMapping("/users/recycles/preview/download")
    public ResponseEntity<InputStreamResource> downloadRecyclePreview(
        @RequestParam("userId") Long userId,
        @RequestParam("recycleId") Long recycleId,
        @RequestParam("path") String path) {
        requireAdmin();
        if (StringUtils.isBlank(path)) {
            return ResponseEntity.badRequest().build();
        }
        InputStream inputStream = recycleService.downloadPreviewFile(userId, recycleId, path);
        String fileName = path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
        String encodedFileName = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename*=UTF-8''" + encodedFileName)
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .body(new InputStreamResource(inputStream));
    }

    private void requireAdmin() {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new AccessDeniedException("仅平台管理员可以管理用户存储配额");
        }
    }

    private static Long longValue(Object value) {
        if (value == null) {
            throw new IllegalArgumentException("参数不能为空");
        }
        return Long.valueOf(String.valueOf(value));
    }
}
