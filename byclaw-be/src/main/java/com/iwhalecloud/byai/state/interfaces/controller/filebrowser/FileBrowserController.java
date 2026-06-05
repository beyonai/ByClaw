package com.iwhalecloud.byai.state.interfaces.controller.filebrowser;

import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserDeleteRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserListRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserMoveRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserRenameRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

@RestController
@RequestMapping("/fileBrowser")
public class FileBrowserController {

    @Autowired
    private FileBrowserApplicationService fileBrowserService;

    @PostMapping("/list")
    public ResponseUtil list(@RequestBody FileBrowserListRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        String path = StringUtils.defaultIfBlank(request.getPath(), "/");
        List<FileBrowserItemVo> items = fileBrowserService.list(userCode, request.getResourceId(), path);
        return ResponseUtil.successResponse(items);
    }

    @GetMapping("/defaultPath")
    public ResponseUtil defaultPath(@RequestParam("resourceId") Long resourceId) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (resourceId == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        String defaultPath = fileBrowserService.getDefaultPath(resourceId);
        return ResponseUtil.successResponse(defaultPath);
    }

    @PostMapping("/upload")
    public ResponseUtil upload(
        @RequestParam("files") MultipartFile[] files,
        @RequestParam("resourceId") Long resourceId,
        @RequestParam(value = "path", defaultValue = "/") String path) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (resourceId == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (files == null || files.length == 0) {
            return ResponseUtil.fail("请选择要上传的文件");
        }
        try {
            fileBrowserService.upload(userCode, resourceId, path, files);
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("上传失败: " + e.getMessage());
        }
    }

    @GetMapping("/download")
    public ResponseEntity<InputStreamResource> download(
        @RequestParam("resourceId") Long resourceId,
        @RequestParam("path") String path) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode) || resourceId == null || StringUtils.isBlank(path)) {
            return ResponseEntity.badRequest().build();
        }
        try {
            InputStream inputStream = fileBrowserService.download(userCode, resourceId, path);
            String fileName = path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
            String encodedFileName = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");

            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + encodedFileName)
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(new InputStreamResource(inputStream));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @PostMapping("/delete")
    public ResponseUtil delete(@RequestBody FileBrowserDeleteRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (request.getPaths() == null || request.getPaths().isEmpty()) {
            return ResponseUtil.fail("paths is required");
        }
        try {
            fileBrowserService.delete(userCode, request.getResourceId(), request.getPaths());
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("删除失败: " + e.getMessage());
        }
    }

    @PostMapping("/rename")
    public ResponseUtil rename(@RequestBody FileBrowserRenameRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (StringUtils.isBlank(request.getSourcePath())) {
            return ResponseUtil.fail("sourcePath is required");
        }
        if (StringUtils.isBlank(request.getNewName())) {
            return ResponseUtil.fail("newName is required");
        }
        try {
            fileBrowserService.rename(userCode, request.getResourceId(), request.getSourcePath(), request.getNewName());
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("重命名失败: " + e.getMessage());
        }
    }

    @PostMapping("/move")
    public ResponseUtil move(@RequestBody FileBrowserMoveRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (request.getSourcePaths() == null || request.getSourcePaths().isEmpty()) {
            return ResponseUtil.fail("sourcePaths is required");
        }
        if (StringUtils.isBlank(request.getTargetDirectory())) {
            return ResponseUtil.fail("targetDirectory is required");
        }
        try {
            fileBrowserService.move(userCode, request.getResourceId(), request.getSourcePaths(),
                request.getTargetDirectory());
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("移动失败: " + e.getMessage());
        }
    }

    @PostMapping("/createFolder")
    public ResponseUtil createFolder(@RequestBody FileBrowserListRequest request) {
        String userCode = CurrentUserHolder.getCurrentUserCode();
        if (StringUtils.isBlank(userCode)) {
            return ResponseUtil.fail("用户未登录");
        }
        if (request.getResourceId() == null) {
            return ResponseUtil.fail("resourceId is required");
        }
        if (StringUtils.isBlank(request.getPath())) {
            return ResponseUtil.fail("path is required");
        }
        try {
            fileBrowserService.createFolder(userCode, request.getResourceId(), request.getPath());
            return ResponseUtil.successResponse();
        } catch (Exception e) {
            return ResponseUtil.fail("创建文件夹失败: " + e.getMessage());
        }
    }
}
