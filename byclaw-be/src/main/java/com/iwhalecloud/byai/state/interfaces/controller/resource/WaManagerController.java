package com.iwhalecloud.byai.state.interfaces.controller.resource;

import io.swagger.v3.oas.annotations.Operation;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.NotEmpty;

/**
 * @author he.duming
 * @date 2025-05-10 11:21:15
 * @description 智能体接口暴露
 */

@RestController
@RequestMapping(value = {
    "/WaManagerService", "/knowledge/WaManagerService"
})
public class WaManagerController {

    /**
     * 获取图标
     *
     * @param response 响应流
     * @param style 下载类型，当前为MINIO
     * @param bucketName 桶名称
     * @param fileName 文件名
     */
    @Operation(summary = "获取图标", description = "获取指定样式的图标", tags = "文件管理")
    @GetMapping(path = "/commonFile/preview")
    public void getICorn(HttpServletResponse response,
        @NotEmpty(message = "{wamanagercontroller.style.notempty}") @RequestParam("style") String style,
        @RequestParam(value = "systemCode", required = false) String systemCode,
        @RequestParam("bucketName") @NotEmpty(message = "{wamanagercontroller.bucketname.notempty}") String bucketName,
        @RequestParam("fileName") @NotEmpty(message = "{wamanagercontroller.filename.notempty}") String fileName) {

    }
}
