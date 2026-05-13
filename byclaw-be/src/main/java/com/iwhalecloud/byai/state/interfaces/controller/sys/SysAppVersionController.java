package com.iwhalecloud.byai.state.interfaces.controller.sys;

import com.iwhalecloud.byai.manager.entity.system.SysAppVersion;
import com.iwhalecloud.byai.state.domain.sys.service.SysAppVersionService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

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
    public ResponseUtil getLatestVersion(@RequestParam(name = "deviceType") String deviceType) {
        SysAppVersion version = sysAppVersionService.getLatestVersion(deviceType);
        return ResponseUtil.successResponse(version);
    }
}