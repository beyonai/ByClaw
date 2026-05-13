package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.showcase.ContentTypeConstant;
import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.apache.commons.collections4.CollectionUtils;

import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;

@Slf4j
@Component
public class RecordShowcaseStrategy extends BaseFileShowcaseStrategy {

    public static final String TYPE = "record";

    @Value("${feign.memobit.url:}")
    private String meetingServiceUrl;

    private String meetingDownloadPath = "/v1/meeting/download/minute";

    private final RestTemplate showcaseFileRestTemplate;

    private final ShowcaseStorageHelper storageHelper;

    public RecordShowcaseStrategy(@Qualifier("showcaseFileRestTemplate") RestTemplate showcaseFileRestTemplate,
                                  ShowcaseStorageHelper storageHelper) {
        this.showcaseFileRestTemplate = showcaseFileRestTemplate;
        this.storageHelper = storageHelper;
    }

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    protected String fileExtension() {
        return ".txt";
    }

    @Override
    protected String mediaType() {
        return "text/plain;charset=UTF-8";
    }

    @Override
    protected ShowcaseStoragePayload downloadOriginalFile(ByaiShowcase showcase) {
        RecordPayload payload = parseRecordPayload(showcase.getContent());
        if (payload == null) {
            log.warn("record类型成果内容为空或格式错误，showcaseId={}", showcase.getId());
            return ShowcaseStoragePayload.empty();
        }
        String meetingNumber = StringUtils.defaultIfBlank(payload.getMeetingNumber(),
            String.valueOf(showcase.getMessageId()));
        showcase.setFileCode(ContentTypeConstant.record + meetingNumber);
        if (recoverIfNecessary(showcase)) {
            return ShowcaseStoragePayload.empty();
        }

        // 先尝试从会议服务下载文件
        String fallbackFileName = buildFileName(StringUtils.defaultIfBlank(payload.getTitle(), showcase.getName()));
        ShowcaseStoragePayload downloadedPayload = downloadFromUrl(meetingNumber, fallbackFileName);
        if (downloadedPayload != null && !downloadedPayload.isEmpty()) {
            return downloadedPayload;
        }
        // 下载失败时记录日志，继续执行回退逻辑
        log.warn("从会议服务下载record文件失败，回退到生成文件逻辑 showcaseId={} meetingNumber={}", 
            showcase.getId(), payload.getMeetingNumber());

        // 回退逻辑：从minute内容生成文件
        byte[] fileContent = buildMinuteFile(payload).getBytes(StandardCharsets.UTF_8);
        String fileName = buildFileName(StringUtils.defaultIfBlank(payload.getTitle(), showcase.getName()));
        return ShowcaseStoragePayload.of(fileContent, fileName, mediaType());
    }

    @Override
    protected ShowcaseStoragePayload uploadToObjectStorage(ByaiShowcase showcase,
                                                           ShowcaseStoragePayload downloadedPayload) {
        if (downloadedPayload == null) {
            log.warn("downloadedPayload is null for showcaseId={}", showcase.getId());
            return ShowcaseStoragePayload.empty();
        }
        return storageHelper.upload(showcase, downloadedPayload);
    }

    private String buildMinuteFile(RecordPayload payload) {
        StringBuilder builder = new StringBuilder();
        builder.append("会议标题: ").append(StringUtils.defaultIfBlank(payload.getTitle(), "录音记录")).append("\n");
        builder.append("会议编号: ").append(StringUtils.defaultIfBlank(payload.getMeetingNumber(), "-")).append("\n");
        if (StringUtils.isNotBlank(payload.getUrl())) {
            builder.append("会议详情链接: ").append(payload.getUrl()).append("\n");
        }
        builder.append("\n");
        builder.append(StringUtils.defaultIfBlank(payload.getMinute(), "暂无会议纪要"));
        return builder.toString();
    }

    private RecordPayload parseRecordPayload(String content) {
        if (StringUtils.isBlank(content)) {
            return null;
        }

        Map<String, Object> root = JSONObject.parseObject(content);
        Map<String, Object> substanceObj = (Map<String, Object>) MapUtils.getObject(root, "substance");

        RecordPayload payload = new RecordPayload();
        payload.setTitle(MapUtils.getString(substanceObj, "title"));
        payload.setUrl(MapUtils.getString(substanceObj, "url"));
        payload.setMinute(MapUtils.getString(substanceObj, "minute"));
        payload.setMeetingNumber(MapUtils.getString(substanceObj, "meetingNumber"));
        return payload;

    }


    /**
     * 构建会议下载服务URL
     * 
     * @return 完整的下载服务URL
     */
    private String buildMeetingDownloadUrl() {
        return String.format("%s%s", meetingServiceUrl, meetingDownloadPath);
    }

    /**
     * 从会议服务下载文件
     * 
     * @param meetingNumber 会议编号
     * @param fallbackFileName 备用文件名（当响应头中没有文件名时使用）
     * @return 下载结果，如果下载失败则返回null
     */
    private ShowcaseStoragePayload downloadFromUrl(String meetingNumber, String fallbackFileName) {
        if (StringUtils.isBlank(meetingNumber)) {
            log.warn("会议编号为空，无法下载record文件 meetingNumber={}", meetingNumber);
            return null;
        }

        try {
            String downloadUrl = buildMeetingDownloadUrl();
            
            // 构建请求体
            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("meeting_number", meetingNumber);
            
            // 设置请求头
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("accept", "application/json");
            
            HttpEntity<Map<String, Object>> requestEntity = new HttpEntity<>(requestBody, headers);
            
            // 发送POST请求
            ResponseEntity<byte[]> response = showcaseFileRestTemplate.exchange(
                downloadUrl,
                HttpMethod.POST,
                requestEntity,
                byte[].class
            );
            
            byte[] body = response.getBody();
            if (body == null || body.length == 0) {
                log.warn("record文件下载内容为空，meetingNumber={} downloadUrl={}",
                    meetingNumber, downloadUrl);
                return null;
            }
            
            // 从响应头中提取文件名，优先使用服务器返回的文件名
            String fileName = resolveFileNameFromResponse(response.getHeaders(), fallbackFileName);
            MediaType contentType = response.getHeaders().getContentType();
            String resolvedType = contentType == null ? mediaType() : contentType.toString();
            log.info("record文件下载成功 meetingNumber={} downloadUrl={} fileName={} size={}", 
                meetingNumber, downloadUrl, fileName, body.length);
            return ShowcaseStoragePayload.of(body, fileName, resolvedType);
        } catch (Exception ex) {
            log.error("record文件下载失败，meetingNumber={}", meetingNumber, ex);
            return null;
        }
    }

    /**
     * 从响应头中解析文件名
     * 优先从 Content-Disposition 头中提取，如果没有则使用备用文件名
     * 
     * @param responseHeaders 响应头
     * @param fallbackFileName 备用文件名
     * @return 解析后的文件名
     */
    private String resolveFileNameFromResponse(HttpHeaders responseHeaders, String fallbackFileName) {
        if (responseHeaders == null) {
            return fallbackFileName;
        }
        
        // 尝试从 Content-Disposition 头中提取文件名
        Collection<String> contentDispositions = responseHeaders.get(HttpHeaders.CONTENT_DISPOSITION);
        if (CollectionUtils.isNotEmpty(contentDispositions)) {
            for (String disposition : contentDispositions) {
                if (StringUtils.isBlank(disposition)) {
                    continue;
                }
                try {
                    ContentDisposition cd = ContentDisposition.parse(disposition);
                    String fileName = cd.getFilename();
                    if (StringUtils.isNotBlank(fileName)) {
                        // URL解码文件名（服务器可能对中文文件名进行了编码）
                        return fileName;
                    }
                } catch (Exception ex) {
                    log.debug("解析Content-Disposition头中的文件名失败: {}", ex.getMessage());
                }
            }
        }
        
        // 如果没有从响应头中获取到文件名，使用备用文件名
        return StringUtils.isNotBlank(fallbackFileName) ? fallbackFileName : "record" + fileExtension();
    }

    private static final class RecordPayload {

        private String title;

        private String url;

        private String minute;

        private String meetingNumber;

        public String getTitle() {
            return title;
        }

        public void setTitle(String title) {
            this.title = title;
        }

        public String getUrl() {
            return url;
        }

        public void setUrl(String url) {
            this.url = url;
        }

        public String getMinute() {
            return minute;
        }

        public void setMinute(String minute) {
            this.minute = minute;
        }

        public String getMeetingNumber() {
            return meetingNumber;
        }

        public void setMeetingNumber(String meetingNumber) {
            this.meetingNumber = meetingNumber;
        }
    }
}

