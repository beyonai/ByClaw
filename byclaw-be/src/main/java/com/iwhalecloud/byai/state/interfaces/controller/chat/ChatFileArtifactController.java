package com.iwhalecloud.byai.state.interfaces.controller.chat;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.chat.ChatFileArtifactApplicationService;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService.FsDownload;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatFileArtifactResolveRequest;
import com.iwhalecloud.byai.state.domain.chat.vo.ChatFileArtifactVo;

/**
 * 对话回复文件解析与下载接口。
 *
 * @author qin.guoquan
 * @date 2026-08-18 20:00:38
 */
@RestController
@RequestMapping("/chat/file-artifacts")
public class ChatFileArtifactController {

    private final ChatFileArtifactApplicationService chatFileArtifactApplicationService;

    public ChatFileArtifactController(ChatFileArtifactApplicationService chatFileArtifactApplicationService) {
        this.chatFileArtifactApplicationService = chatFileArtifactApplicationService;
    }

    @PostMapping("/resolve")
    public ResponseUtil<List<ChatFileArtifactVo>> resolve(@RequestBody ChatFileArtifactResolveRequest request) {
        return ResponseUtil.successResponse(chatFileArtifactApplicationService.resolve(request));
    }

    @GetMapping("/download")
    public ResponseEntity<StreamingResponseBody> download(@RequestParam("sessionId") Long sessionId,
        @RequestParam("path") String path) {
        FsDownload download = chatFileArtifactApplicationService.download(sessionId, path);
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(download.getContentType()))
            .header(HttpHeaders.CONTENT_DISPOSITION, buildContentDisposition(download.getFileName()))
            .header("X-Content-Type-Options", "nosniff")
            .body(download.getBody());
    }

    private String buildContentDisposition(String fileName) {
        String resolvedFileName = StringUtils.defaultIfBlank(fileName, "download");
        String encoded = URLEncoder.encode(resolvedFileName, StandardCharsets.UTF_8).replace("+", "%20");
        return "attachment; filename=\"" + encoded + "\"; filename*=UTF-8''" + encoded;
    }
}
