package com.iwhalecloud.byai.state.interfaces.controller.sys;

import java.io.IOException;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.entity.system.SysAppVersion;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.sys.dto.AppVersionQuery;
import com.iwhalecloud.byai.state.domain.sys.dto.AppVersionRequest;
import com.iwhalecloud.byai.state.domain.sys.dto.AppVersionUploadResult;
import com.iwhalecloud.byai.state.domain.sys.service.SysAppVersionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 应用版本信息控制器
 */
@RestController
@RequestMapping("/api/v1/appVersion")
@Tag(name = "应用版本接口", description = "应用版本相关接口")
public class SysAppVersionController {

    @Autowired
    private SysAppVersionService sysAppVersionService;

    @Operation(summary = "获取最新版本", description = "根据设备类型获取最新版本信息，支持iOS和Android两种设备类型", responses = {
        @ApiResponse(responseCode = "0", description = "获取成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    @GetMapping("/latest")
    public ResponseUtil getLatestVersion(@RequestParam(name = "deviceType") String deviceType,
        @RequestParam(name = "platform", required = false) String platform,
        @RequestParam(name = "arch", required = false) String arch,
        @RequestParam(name = "channel", required = false) String channel) {
        SysAppVersion version = sysAppVersionService.getLatestVersion(deviceType, platform, arch, channel);
        return ResponseUtil.successResponse(version);
    }

    /**
     * 桌面端更新只做裸 fetch，不带登录凭证，因此该下载接口必须免登录。
     */
    @Operation(summary = "下载安装包", description = "按版本id下载安装包，供桌面端自动更新免登录调用")
    @GetMapping("/package/{versionId}")
    public void downloadPackage(@PathVariable("versionId") Long versionId, HttpServletResponse response)
        throws IOException {
        sysAppVersionService.downloadPackage(versionId, response);
    }

    @Operation(summary = "版本管理能力", description = "仅开源版 adminvip 返回 true")
    @GetMapping("/admin/manage-capability")
    public ResponseUtil<Boolean> manageCapability() {
        return ResponseUtil.successResponse(sysAppVersionService.canManage());
    }

    @GetMapping("/admin/page")
    public ResponseUtil<PageInfo<SysAppVersion>> page(AppVersionQuery query) {
        return ResponseUtil.successResponse(sysAppVersionService.page(query));
    }

    @PostMapping("/admin")
    public ResponseUtil<SysAppVersion> create(@Valid @RequestBody AppVersionRequest request) {
        return ResponseUtil.successResponse(sysAppVersionService.save(null, request));
    }

    @PutMapping("/admin/{versionId}")
    public ResponseUtil<SysAppVersion> update(@PathVariable("versionId") Long versionId,
        @Valid @RequestBody AppVersionRequest request) {
        return ResponseUtil.successResponse(sysAppVersionService.save(versionId, request));
    }

    @PostMapping("/admin/{versionId}/publish")
    public ResponseUtil<SysAppVersion> publish(@PathVariable("versionId") Long versionId) {
        return ResponseUtil.successResponse(sysAppVersionService.publish(versionId));
    }

    @PostMapping("/admin/{versionId}/offline")
    public ResponseUtil<SysAppVersion> offline(@PathVariable("versionId") Long versionId) {
        return ResponseUtil.successResponse(sysAppVersionService.offline(versionId));
    }

    @DeleteMapping("/admin/{versionId}")
    public ResponseUtil<Void> delete(@PathVariable("versionId") Long versionId) {
        sysAppVersionService.delete(versionId);
        return ResponseUtil.successResponse();
    }

    @PostMapping(value = "/admin/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<AppVersionUploadResult> uploadPackage(@RequestPart("file") MultipartFile file) {
        return ResponseUtil.successResponse(sysAppVersionService.uploadPackage(file));
    }
}