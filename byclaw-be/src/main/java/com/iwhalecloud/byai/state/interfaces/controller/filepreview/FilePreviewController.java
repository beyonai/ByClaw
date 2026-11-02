package com.iwhalecloud.byai.state.interfaces.controller.filepreview;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.state.application.service.filepreview.FilePreviewApplicationService;

/** 使用现有登录拦截器鉴权，仅返回预览副本，原文件仍从原下载接口获取。 */
@RestController
@RequestMapping("/file-preview")
public class FilePreviewController {

    private final FilePreviewApplicationService service;

    public FilePreviewController(FilePreviewApplicationService service) {
        this.service = service;
    }

    @PostMapping(value = "/legacy-office", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<byte[]> convert(@RequestParam("file") MultipartFile file) {
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_PDF)
            .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"preview.pdf\"")
            .header(HttpHeaders.CACHE_CONTROL, "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .body(service.convert(file));
    }
}
