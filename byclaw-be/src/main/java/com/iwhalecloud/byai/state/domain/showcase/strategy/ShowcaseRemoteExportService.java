package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.feign.client.FeignAiWriterService;
import feign.Response;
import java.io.BufferedInputStream;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;

/**
 * 远程文稿导出服务，封装 PPT、DOC 导出接口的调用。
 */
@Slf4j
@Component
public class ShowcaseRemoteExportService {

    private static final String DEFAULT_DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    private static final String DEFAULT_PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    private final FeignAiWriterService feignAiWriterService;

    public ShowcaseRemoteExportService(FeignAiWriterService feignAiWriterService) {
        this.feignAiWriterService = feignAiWriterService;
    }

    public ExportedFile exportPpt(Long pptId) {
        if (pptId == null) {
            log.warn("PPT导出ID为空，跳过导出");
            return ExportedFile.empty();
        }
        Map<String, Object> body = new HashMap<>();
        body.put("topCont", new HashMap<>());
        Map<String, Object> svcCont = new HashMap<>();
        svcCont.put("id", pptId);
        body.put("svcCont", svcCont);

        try (Response response = feignAiWriterService.exportPpt(body)) {
            return processResponse(response, DEFAULT_PPTX_MEDIA_TYPE);
        }
        catch (IOException e) {
            throw new BdpRuntimeException(I18nUtil.get("showcase.remote.export.document.exception"), e);
        }

    }

    public ExportedFile exportDoc(Long docId, String outputFormat) {
        if (docId == null) {
            log.warn("DOC导出ID为空，跳过导出");
            return ExportedFile.empty();
        }
        String format = StringUtils.defaultIfBlank(outputFormat, "docx");
        Map<String, Object> body = new HashMap<>();
        body.put("topCont", new HashMap<>());
        Map<String, Object> svcCont = new HashMap<>();
        svcCont.put("docId", docId);
        svcCont.put("outputFormat", format);
        body.put("svcCont", svcCont);
        String mediaType = "pdf".equalsIgnoreCase(format) ? MediaType.APPLICATION_PDF_VALUE : DEFAULT_DOCX_MEDIA_TYPE;
        try (Response response = feignAiWriterService.exportDoc(body)) {
            return processResponse(response, mediaType);
        }
        catch (IOException ex) {
            log.error("远程导出文档异常", ex);
            return ExportedFile.empty();
        }
    }

    private ExportedFile processResponse(Response response, String defaultMediaType) throws IOException {
        if (response == null) {
            log.warn("远程导出返回空响应");
            return ExportedFile.empty();
        }
        int status = response.status();
        if (status < 200 || status >= 300) {
            log.warn("远程导出失败，状态码={}", status);
            return ExportedFile.empty();
        }
        if (response.body() == null) {
            log.warn("远程导出返回空文件体");
            return ExportedFile.empty();
        }
        byte[] data;
        try (InputStream inputStream = response.body().asInputStream();
            BufferedInputStream bufferedInputStream = new BufferedInputStream(inputStream)) {
            data = bufferedInputStream.readAllBytes();
        }
        if (data.length == 0) {
            log.warn("远程导出返回空文件数据");
            return ExportedFile.empty();
        }
        String mediaTypeValue = resolveMediaType(response, defaultMediaType);
        String fileName = resolveFileName(response);
        return new ExportedFile(data, mediaTypeValue, fileName);
    }

    private String resolveMediaType(Response response, String defaultMediaType) {
        String contentType = getFirstHeader(response, HttpHeaders.CONTENT_TYPE);
        if (StringUtils.isBlank(contentType)) {
            return defaultMediaType;
        }
        try {
            MediaType mediaType = MediaType.parseMediaType(contentType);
            return mediaType.toString();
        }
        catch (Exception ex) {
            log.debug("解析 Content-Type 失败，使用默认类型 {}", defaultMediaType, ex);
            return defaultMediaType;
        }
    }

    private String resolveFileName(Response response) {
        String disposition = getFirstHeader(response, HttpHeaders.CONTENT_DISPOSITION);
        if (StringUtils.isBlank(disposition)) {
            return null;
        }
        try {
            ContentDisposition cd = ContentDisposition.parse(disposition);
            String fileName = cd.getFilename();
            if (StringUtils.isBlank(fileName)) {
                return null;
            }
            try {
                String decodedFileName = URLDecoder.decode(fileName, StandardCharsets.UTF_8);
                // 检查并移除路径遍历字符和路径分隔符
                // 1. 匹配 .. 序列（路径遍历攻击）
                // 2. 匹配路径分隔符 / 和 \
                String normalized = decodedFileName.replaceAll("\\.\\.|[/\\\\]", "");
                if (!normalized.equals(decodedFileName)) {
                    log.warn("文件名包含非法路径字符: {}", decodedFileName);
                    return null;
                }
                // 进一步检查文件名格式是否合法
                // 要求：文件名由字母、数字、点号、下划线、连字符组成，必须有扩展名且扩展名至少2个字母
                // 注意：字符类中的 - 需要转义或放在开头/结尾，这里放在结尾避免转义
                if (!normalized.matches("^[a-zA-Z0-9._-]+\\.([a-zA-Z]{2,})$")) {
                    log.warn("文件名格式不合法: {}", decodedFileName);
                    return null;
                }
                // 检查文件名长度，防止过长文件名
                if (normalized.length() > 255) {
                    log.warn("文件名过长: {}", decodedFileName);
                    return null;
                }

                return decodedFileName;
            }
            catch (Exception ex) {
                log.debug("文件名URL解码失败: {}", ex.getMessage());
                return null;
            }
        }
        catch (Exception ex) {
            log.debug("解析 Content-Disposition 失败: {}", ex.getMessage());
            return null;
        }
    }

    private String getFirstHeader(Response response, String headerName) {
        Collection<String> values = response.headers().get(headerName);
        if (values == null || values.isEmpty()) {
            return null;
        }
        return values.iterator().next();
    }

    /**
     * 导出文件载体。
     */
    @Getter
    public static final class ExportedFile {

        private final byte[] data;

        private final String mediaType;

        private final String fileName;

        private ExportedFile(byte[] data, String mediaType, String fileName) {
            this.data = data;
            this.mediaType = mediaType;
            this.fileName = fileName;
        }

        public static ExportedFile empty() {
            return new ExportedFile(new byte[0], null, null);
        }

        public boolean isEmpty() {
            return data == null || data.length == 0;
        }

        public String getFileName() {
            return fileName;
        }
    }
}
