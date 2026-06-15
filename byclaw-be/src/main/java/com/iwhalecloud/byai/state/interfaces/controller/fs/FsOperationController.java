package com.iwhalecloud.byai.state.interfaces.controller.fs;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService.FsDownload;
import com.iwhalecloud.byai.state.domain.fs.dto.FsDirectoryRequest;
import com.iwhalecloud.byai.state.domain.fs.dto.FsFileDeleteRequest;
import com.iwhalecloud.byai.state.domain.fs.dto.FsRenameRequest;
import com.iwhalecloud.byai.state.domain.fs.vo.FsDeleteResultVo;
import com.iwhalecloud.byai.state.domain.fs.vo.FsDirectoryRenameResultVo;
import com.iwhalecloud.byai.state.domain.fs.vo.FsFileMetadataVo;
import com.iwhalecloud.byai.state.domain.fs.vo.FsRenameResultVo;

/**
 * 对外暴露 USER / RESOURCE 两类 MinIO 文件空间的基础操作接口。
 * 鉴权由统一拦截器校验 beyond-token，本 Controller 保持薄层转发。
 *
 * @author qin.guoquan
 * @date 2026-06-10 17:38:38
 */
@RestController
@RequestMapping("/fs/operation/v1")
public class FsOperationController {

    @Autowired
    private FsOperationApplicationService fsOperationApplicationService;

    @PostMapping(value = "/files/put", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<FsFileMetadataVo> putFile(@RequestParam("spaceType") String spaceType,
        @RequestParam(value = "resourceId", required = false) Long resourceId,
        @RequestParam("path") String path,
        @RequestParam(value = "contentType", required = false) String contentType,
        @RequestParam("file") MultipartFile file) {
        return ResponseUtil.successResponse(fsOperationApplicationService.putFile(spaceType, resourceId, path,
            contentType, file));
    }

    @GetMapping("/files/get")
    public ResponseEntity<StreamingResponseBody> getFile(@RequestParam("spaceType") String spaceType,
        @RequestParam(value = "resourceId", required = false) Long resourceId,
        @RequestParam("path") String path) {
        try {
            FsDownload download = fsOperationApplicationService.downloadFile(spaceType, resourceId, path);
            return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(download.getContentType()))
                .header("Content-Disposition", buildContentDisposition(download.getFileName()))
                .body(download.getBody());
        }
        catch (Exception e) {
            // 下载接口返回的是 StreamingResponseBody，异常时保持 HTTP 可读错误文本，避免客户端拿到空流。
            String errorMessage = I18nUtil.get("byclaw.fs.download.failed", e.getMessage());
            return ResponseEntity.badRequest().contentType(MediaType.parseMediaType("text/plain; charset=UTF-8"))
                .body(outputStream -> outputStream.write(errorMessage.getBytes(StandardCharsets.UTF_8)));
        }
    }

    @PostMapping("/files/delete")
    public ResponseUtil<FsDeleteResultVo> deleteFile(@RequestBody FsFileDeleteRequest request) {
        return ResponseUtil.successResponse(fsOperationApplicationService.deleteFile(request));
    }

    @PostMapping("/directories/create")
    public ResponseUtil<FsDeleteResultVo> createDirectory(@RequestBody FsDirectoryRequest request) {
        return ResponseUtil.successResponse(fsOperationApplicationService.createDirectory(request));
    }

    @PostMapping("/directories/delete")
    public ResponseUtil<FsDeleteResultVo> deleteDirectory(@RequestBody FsDirectoryRequest request) {
        return ResponseUtil.successResponse(fsOperationApplicationService.deleteDirectory(request));
    }

    @PostMapping("/files/rename")
    public ResponseUtil<FsRenameResultVo> renameFile(@RequestBody FsRenameRequest request) {
        return ResponseUtil.successResponse(fsOperationApplicationService.renameFile(request));
    }

    @PostMapping("/directories/rename")
    public ResponseUtil<FsDirectoryRenameResultVo> renameDirectory(@RequestBody FsRenameRequest request) {
        return ResponseUtil.successResponse(fsOperationApplicationService.renameDirectory(request));
    }

    private String buildContentDisposition(String fileName) {
        String resolvedFileName = StringUtils.defaultIfBlank(fileName, "download");
        // 同时提供 filename 和 RFC 5987 filename*，兼容浏览器和脚本客户端下载中文文件名。
        String encoded = URLEncoder.encode(resolvedFileName, StandardCharsets.UTF_8).replace("+", "%20");
        return "attachment; filename=\"" + encoded + "\"; filename*=UTF-8''" + encoded;
    }
}
