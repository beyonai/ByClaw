package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDownloadResult;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.HtmlUtils;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.web.util.UriComponentsBuilder;
import org.apache.commons.codec.digest.DigestUtils;

@Slf4j
@Component
public class ImageShowcaseStrategy extends BaseFileShowcaseStrategy {

    public static final String TYPE = "image";

    private static final Pattern HREF_PATTERN = Pattern.compile("href\\s*=\\s*\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);

    private static final Pattern SRC_PATTERN = Pattern.compile("src\\s*=\\s*\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);

    private static final Pattern DOWNLOAD_PATTERN = Pattern.compile("download\\s*=\\s*\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);

    private final RestTemplate showcaseFileRestTemplate;

    private final ShowcaseStorageHelper storageHelper;

    public ImageShowcaseStrategy(@Qualifier("showcaseFileRestTemplate") RestTemplate showcaseFileRestTemplate,
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
        return ".png";
    }

    @Override
    protected String mediaType() {
        return "image/png";
    }

    @Override
    public ShowcaseDownloadResult download(ByaiShowcase showcase) {
        String downloadUrl = resolveDownloadUrl(showcase.getContent());
        if (StringUtils.isBlank(downloadUrl)) {
            // 内容中没有可解析的下载链接时，降级为返回原始内容，避免影响既有功能。
            return super.download(showcase);
        }
        if (!StringUtils.startsWithAny(downloadUrl.toLowerCase(Locale.ROOT), "http://", "https://")) {
            // 仅允许 http/https，避免误用其他协议带来的安全隐患。
            log.warn("非法的图片下载地址: {}", downloadUrl);
            return super.download(showcase);
        }
        try {
            ResponseEntity<byte[]> response = showcaseFileRestTemplate.getForEntity(downloadUrl, byte[].class);
            byte[] body = response.getBody();
            String finalFileName = resolveFileName(showcase, showcase.getContent(), downloadUrl);
            MediaType responseType = response.getHeaders().getContentType();
            String finalContentType = responseType == null ? mediaType() : responseType.toString();
            return ShowcaseDownloadResult.of(body, finalFileName, finalContentType);
        } catch (Exception ex) {
            // 下载异常时记录日志并回退至旧实现，保证业务兜底。
            log.error("下载图片成果失败, showcaseId={}, downloadUrl={}", showcase.getId(), downloadUrl, ex);
            return super.download(showcase);
        }
    }

    private String resolveDownloadUrl(String content) {
        if (StringUtils.isBlank(content)) {
            return null;
        }
        String unwrapped = unwrapContentIfJson(content);
        String href = extractFirstMatch(unwrapped, HREF_PATTERN);
        if (StringUtils.isNotBlank(href)) {
            return href;
        }
        return extractFirstMatch(unwrapped, SRC_PATTERN);
    }

    private String resolveFileName(ByaiShowcase showcase, String content, String downloadUrl) {
        // download 属性优先，其次使用名称字段，最后回退到 URL 末段。
        String unwrapped = unwrapContentIfJson(content);
        String downloadAttr = extractFirstMatch(unwrapped, DOWNLOAD_PATTERN);
        if (StringUtils.isNotBlank(downloadAttr)) {
            return appendExtensionIfMissing(downloadAttr);
        }
        if (StringUtils.isNotBlank(showcase.getName())) {
            return appendExtensionIfMissing(showcase.getName());
        }
        String urlFileName = extractFileNameFromUrl(downloadUrl);
        if (StringUtils.isNotBlank(urlFileName)) {
            return appendExtensionIfMissing(urlFileName);
        }
        return "image" + fileExtension();
    }

    private String appendExtensionIfMissing(String fileName) {
        if (StringUtils.isBlank(fileName)) {
            return "image" + fileExtension();
        }
        String trimmed = fileName.trim();
        if (trimmed.toLowerCase(Locale.ROOT).endsWith(fileExtension())) {
            return trimmed;
        }
        return trimmed + fileExtension();
    }

    private String extractFileNameFromUrl(String downloadUrl) {
        try {
            URI uri = new URI(downloadUrl);
            String path = uri.getPath();
            if (StringUtils.isBlank(path)) {
                return null;
            }
            int index = path.lastIndexOf('/');
            if (index >= 0 && index < path.length() - 1) {
                return path.substring(index + 1);
            }
            return path;
        } catch (URISyntaxException ex) {
            log.warn("下载地址解析失败: {}", downloadUrl, ex);
            return null;
        }
    }

    private String extractFirstMatch(String content, Pattern pattern) {
        Matcher matcher = pattern.matcher(content);
        if (matcher.find()) {
            return htmlDecode(matcher.group(1));
        }
        return null;
    }

    @Override
    protected ShowcaseStoragePayload downloadOriginalFile(ByaiShowcase showcase) {
        String downloadUrl = showcase.getContent();
        if (StringUtils.isBlank(downloadUrl)) {
            log.warn("图片成果缺少下载地址，showcaseId={}", showcase.getId());
            return ShowcaseStoragePayload.empty();
        }
        if (!StringUtils.startsWithAny(downloadUrl.toLowerCase(Locale.ROOT), "http://", "https://")) {
            log.warn("图片下载地址协议非法，showcaseId={} downloadUrl={}", showcase.getId(), downloadUrl);
            return ShowcaseStoragePayload.empty();
        }
        try {
            URI uri = UriComponentsBuilder.fromUriString(downloadUrl)
                .build(true)
                .toUri();
            ResponseEntity<byte[]> response = showcaseFileRestTemplate.getForEntity(uri, byte[].class);
            byte[] body = response.getBody();
            if (body == null || body.length == 0) {
                log.warn("图片下载内容为空，showcaseId={} downloadUrl={}", showcase.getId(), downloadUrl);
                return ShowcaseStoragePayload.empty();
            }
            MediaType contentType = response.getHeaders().getContentType();
            String resolvedName = resolveFileName(showcase, showcase.getContent(), downloadUrl);
            String resolvedType = contentType == null ? mediaType() : contentType.toString();
            return ShowcaseStoragePayload.of(body, resolvedName, resolvedType);
        } catch (Exception ex) {
            log.error("图片成果下载失败，showcaseId={} downloadUrl={}", showcase.getId(), downloadUrl, ex);
            return ShowcaseStoragePayload.empty();
        }
    }

    @Override
    protected ShowcaseStoragePayload uploadToObjectStorage(ByaiShowcase showcase,
                                                           ShowcaseStoragePayload downloadedPayload) {
        return storageHelper.upload(showcase, downloadedPayload);
    }

    @Override
    public void beforeSave(ByaiShowcase showcase) {
        String downloadUrl = showcase.getContent();
        if (StringUtils.isNotBlank(downloadUrl)) {
            // 仅用于生成内容指纹做幂等判断，非安全散列，可接受 MD5
            showcase.setFileCode(DigestUtils.md5Hex(downloadUrl));
        }
        if (recoverIfNecessary(showcase)) {
            return;
        }
        super.beforeSave(showcase);
    }

    private String unwrapContentIfJson(String rawContent) {
        if (StringUtils.isBlank(rawContent)) {
            return rawContent;
        }
        List<Map<String, Object>> root = parseJsonContent(rawContent);
        if (root.isEmpty()) {
            return rawContent;
        }
        String extracted = extractFirstDeltaContent(root);
        return StringUtils.isNotBlank(extracted) ? extracted : rawContent;
    }

    private List<Map<String, Object>> parseJsonContent(String rawContent) {
        String trimmed = rawContent.trim();
        if (!trimmed.startsWith("[")) {
            return java.util.Collections.emptyList();
        }
        try {
            return (List<Map<String, Object>>) JSONObject.parseObject(rawContent);
        } catch (Exception ex) {
            log.debug("解析图片成果 content JSON 失败，使用原始内容 showcaseContent={}", rawContent, ex);
            return java.util.Collections.emptyList();
        }
    }

    private String extractFirstDeltaContent(List<Map<String, Object>> root) {
        for (Map<String, Object> element : root) {
            String content = extractFromElement(element);
            if (StringUtils.isNotBlank(content)) {
                return content;
            }
        }
        return null;
    }

    private String extractFromElement(Map<String, Object> element) {
        if (element == null) {
            return null;
        }
        Object choicesObj = element.get("choices");
        if (!(choicesObj instanceof List<?> choices)) {
            return null;
        }
        for (Object choiceObj : choices) {
            String content = extractFromChoice(choiceObj);
            if (StringUtils.isNotBlank(content)) {
                return content;
            }
        }
        return null;
    }

    private String extractFromChoice(Object choiceObj) {
        if (!(choiceObj instanceof Map<?, ?> choice)) {
            return null;
        }
        Object deltaObj = choice.get("delta");
        if (!(deltaObj instanceof Map<?, ?> delta)) {
            return null;
        }
        Object contentObj = delta.get("content");
        return contentObj == null ? null : contentObj.toString();
    }

    private String htmlDecode(String value) {
        if (StringUtils.isBlank(value)) {
            return value;
        }
        return HtmlUtils.htmlUnescape(value);
    }



}
