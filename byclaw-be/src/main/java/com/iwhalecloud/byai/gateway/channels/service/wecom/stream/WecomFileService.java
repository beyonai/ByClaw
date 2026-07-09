package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomFileCrypto;

import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomMsgType;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.PreDestroy;
import java.io.InputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.nio.charset.StandardCharsets;

/**
 * Downloads + decrypts a WeCom media callback and hands the plaintext bytes to
 * the existing upload pipeline as a {@link MessageFileDto}, mirroring
 * {@code DingtalkFileDownloadService} but for the WeCom short-lived encrypted
 * URL + aeskey model (plan §6.7 / Task 7).
 *
 * <p>Security (plan §Task 7): HTTPS-only + host allowlist (no cross-host
 * redirect, SSRF guard), a hard byte cap enforced while streaming (not just a
 * Content-Length check), and NO logging of the url / aeskey.
 */
@Service
public class WecomFileService {

    private static final Logger logger = LoggerFactory.getLogger(WecomFileService.class);

    /** WeCom media hosts. Downloads to any other host are rejected. */
    private static final List<String> ALLOWED_HOST_SUFFIXES = List.of(
            ".qq.com", ".work.weixin.qq.com", ".qpic.cn",".myqcloud.com");

    /** Hard cap; WeCom media max is ~50MB, leave headroom. */
    private static final long MAX_FILE_BYTES = 60L * 1024 * 1024;

    private final AssistantChatApplicationService assistantChatApplicationService;
    private final OkHttpClient httpClient;

    public WecomFileService(AssistantChatApplicationService assistantChatApplicationService) {
        this.assistantChatApplicationService = assistantChatApplicationService;
        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                // Do not auto-follow redirects: the callback URL is
                // attacker-influenceable; a redirect could escape the allowlist.
                .followRedirects(false)
                .followSslRedirects(false)
                .build();
    }

    /** Release the OkHttp dispatcher/pool on shutdown. */
    @PreDestroy
    public void shutdown() {
        httpClient.dispatcher().executorService().shutdown();
        httpClient.connectionPool().evictAll();
    }

    /**
     * If the callback carries media, download+decrypt+upload it and return the
     * resulting file DTOs; otherwise an empty list.
     */
    public List<MessageFileDto> downloadMessageFiles(WecomCallbackMessage message, AssistantChatDto chatDto) {
        String url = message.getMediaUrl();
        String aesKey = message.getMediaAesKey();
        if (!StringUtils.hasText(url)) {
            return Collections.emptyList();
        }

        DownloadedMedia downloadedMedia;
        byte[] plain;
        try {
            downloadedMedia = downloadEncrypted(url);
            plain = StringUtils.hasText(aesKey)
                    ? WecomFileCrypto.decrypt(downloadedMedia.bytes, aesKey)
                    : downloadedMedia.bytes;
        } catch (Exception e) {
            // Never let the url/aeskey into the log line.
            logger.error("WeCom media download/decrypt failed. msgId={}, msgType={}",
                    message.getMsgId(), message.getMsgType(), e);
            throw new IllegalStateException("WeCom media download/decrypt failed", e);
        }

        String fileName = resolveFileName(url, message.getMsgType(), message.getMsgId());
        String contentType = firstNonBlank(downloadedMedia.contentType, defaultContentType(fileName, message.getMsgType()));
        MultipartFile multipart = new WecomDownloadedMultipartFile("file0", fileName, contentType, plain);

        try {
            SessionUploadResult uploadResult = assistantChatApplicationService.uploadFiles(
                    new MultipartFile[]{multipart},
                    chatDto.getSessionId(),
                    SessionType.H_AS.getCode(),
                    chatDto.getAgentId());

            if (uploadResult != null && uploadResult.getSessionId() != null) {
                chatDto.setSessionId(uploadResult.getSessionId());
            }
            return toMessageFiles(uploadResult, message.getMsgType());
        } catch (Exception e) {
            throw new IllegalStateException("WeCom media upload failed", e);
        }
    }

    private DownloadedMedia downloadEncrypted(String url) throws Exception {
        URI uri = URI.create(url);
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("WeCom media url must be https");
        }
        String host = uri.getHost();
        if (host == null || !isAllowedHost(host)) {
            throw new IllegalArgumentException("WeCom media host not allowed");
        }

        Request request = new Request.Builder().url(url).get().build();
        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IllegalStateException("WeCom media download failed, httpCode=" + response.code());
            }
            ResponseBody body = response.body();
            if (body == null) {
                throw new IllegalStateException("WeCom media download empty body");
            }
            MediaType contentType = body.contentType();
            return new DownloadedMedia(readCapped(body.byteStream()), contentType == null ? null : contentType.toString());
        }
    }

    /** Stream and abort past the byte cap (Content-Length can lie or be absent). */
    private byte[] readCapped(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        long total = 0;
        int read;
        while ((read = in.read(chunk)) != -1) {
            total += read;
            if (total > MAX_FILE_BYTES) {
                throw new IllegalStateException("WeCom media exceeds max size " + MAX_FILE_BYTES);
            }
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }

    private boolean isAllowedHost(String host) {
        String lower = host.toLowerCase();
        for (String suffix : ALLOWED_HOST_SUFFIXES) {
            if (lower.endsWith(suffix)) {
                return true;
            }
        }
        return false;
    }

    private String resolveFileName(String url, String msgType, String msgId) {
        String fileName = fileNameFromUrl(url);
        if (StringUtils.hasText(fileName)) {
            return withDefaultExtension(fileName, msgType);
        }
        return defaultFileName(msgType, msgId);
    }

    private String fileNameFromUrl(String url) {
        if (!StringUtils.hasText(url)) {
            return null;
        }
        URI uri = URI.create(url);
        String path = uri.getPath();
        if (!StringUtils.hasText(path)) {
            return null;
        }
        int slashIdx = path.lastIndexOf('/');
        String segment = slashIdx >= 0 ? path.substring(slashIdx + 1) : path;
        if (!StringUtils.hasText(segment)) {
            return null;
        }
        return URLDecoder.decode(segment, StandardCharsets.UTF_8);
    }

    private String defaultFileName(String msgType, String msgId) {
        String base = "wecom_" + (msgId == null ? "media" : msgId);
        return withDefaultExtension(base, msgType);
    }

    private String withDefaultExtension(String fileName, String msgType) {
        if (fileName.contains(".")) {
            return fileName;
        }
        String extension = defaultExtension(msgType);
        return extension == null ? fileName : fileName + "." + extension;
    }

    private String defaultExtension(String msgType) {
        WecomMsgType type = WecomMsgType.fromCode(msgType);
        if (type == null) {
            return null;
        }
        return switch (type) {
            case IMAGE -> "png";
            case VIDEO -> "mp4";
            case VOICE -> "amr";
            default -> null;
        };
    }

    private String defaultContentType(String fileName, String msgType) {
        WecomMsgType type = WecomMsgType.fromCode(msgType);
        if (type == WecomMsgType.IMAGE) {
            return "image/png";
        }
        if (type == WecomMsgType.VIDEO) {
            return "video/mp4";
        }
        if (type == WecomMsgType.VOICE) {
            return "audio/amr";
        }
        return StringUtils.hasText(fileName) ? "application/octet-stream" : null;
    }

    private String firstNonBlank(String first, String second) {
        return StringUtils.hasText(first) ? first : second;
    }

    private List<MessageFileDto> toMessageFiles(SessionUploadResult uploadResult, String msgType) {
        if (uploadResult == null || CollectionUtils.isEmpty(uploadResult.getUploadItems())) {
            return Collections.emptyList();
        }
        boolean isImage = WecomMsgType.IMAGE.matches(msgType);
        List<MessageFileDto> files = new ArrayList<>();
        for (UploadItem item : uploadResult.getUploadItems()) {
            MessageFileDto dto = new MessageFileDto();
            dto.setFileId(item.getFileId() == null ? null : String.valueOf(item.getFileId()));
            dto.setFileName(item.getFileName());
            dto.setFilePath(item.getFilePath());
            dto.setFileUrl(item.getFileUrl());
            dto.setFileType(isImage ? "image" : "file");
            files.add(dto);
        }
        return files;
    }

    private static class DownloadedMedia {
        private final byte[] bytes;
        private final String contentType;

        private DownloadedMedia(byte[] bytes, String contentType) {
            this.bytes = bytes;
            this.contentType = contentType;
        }
    }
}
