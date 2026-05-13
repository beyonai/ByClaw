package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDetailDto;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;

/**
 * 通用文件型成果策略
 *
 * <p>该类型的成果数据已经由前端或其他系统上传，服务端无需再做下载与二次上传。</p>
 */
@Slf4j
@Component
public class FileShowcaseStrategy extends AbstractShowcaseStrategy {

    public static final String TYPE = "file";

    private static final Set<String> TEXT_SUFFIX = Set.of("doc", "docx");

    private static final Set<String> PPT_SUFFIX = Set.of("ppt", "pptx");

    private static final Set<String> EXCEL_SUFFIX = Set.of("xls", "xlsx", "csv", "xlsm");

    private static final Set<String> PDF_SUFFIX = Set.of("pdf");

    private static final Set<String> IMAGE_SUFFIX =
        Set.of("png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "svg");

    private static final Set<String> MARKDOWN_SUFFIX = Set.of("md");

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    public ShowcaseDetailDto buildDetail(ByaiShowcase showcase) {
        return ShowcaseDetailDto.builder(showcase)
            .putAttribute("previewType", TYPE)
            .putAttribute("fileName", StringUtils.defaultIfBlank(showcase.getName(), "未命名文件"))
            .putAttribute("fileUrl", showcase.getUrl())
            .build();
    }

    @Override
    public void beforeSave(ByaiShowcase showcase) {
        FilePayload payload = parseFilePayload(showcase.getContent());
        if (payload == null) {
            log.warn("file成果content为空或格式错误，showcaseId={}", showcase.getId());
            return;
        }
        showcase.setFileId(payload.getFileId());
        showcase.setFileCode(payload.getFileId());
        showcase.setUrl(payload.getFileUrl());
        if (StringUtils.isBlank(showcase.getName())) {
            showcase.setName(payload.getFileName());
        }
        String detectedType = detectFileType(payload);
        if (StringUtils.isNotBlank(detectedType)) {
            showcase.setType(detectedType);
        }
    }

    private FilePayload parseFilePayload(String content) {
        if (StringUtils.isBlank(content)) {
            return null;
        }
        try {
            Map<String, Object> payloadMap = JSONObject.parseObject(content);
            FilePayload payload = new FilePayload();
            payload.setFileId(MapUtils.getString(payloadMap, "fileId"));
            payload.setFileUrl(MapUtils.getString(payloadMap, "fileUrl"));
            payload.setFileName(MapUtils.getString(payloadMap, "fileName"));
            return payload;
        }
        catch (Exception ex) {
            log.error("解析file成果content失败 content={}", content, ex);
            return null;
        }
    }



    public String detectFileType(FilePayload payload) {
        if (payload == null) {
            return "other";
        }
        String baseName = StringUtils.defaultIfBlank(payload.getFileName(), payload.getFileUrl());
        String suffix = extractSuffix(baseName);
        if (suffix == null) {
            return "other";
        }
        if (TEXT_SUFFIX.contains(suffix)) {
            return "text";
        }
        if (PPT_SUFFIX.contains(suffix)) {
            return "ppt";
        }
        if (EXCEL_SUFFIX.contains(suffix)) {
            return "excel";
        }
        if (PDF_SUFFIX.contains(suffix)) {
            return "pdf";
        }
        if (IMAGE_SUFFIX.contains(suffix)) {
            return "image";
        }
        if (MARKDOWN_SUFFIX.contains(suffix)) {
            return "md";
        }
        return "other";
    }

    private String extractSuffix(String fileName) {
        if (StringUtils.isBlank(fileName)) {
            return null;
        }
        int queryIndex = fileName.indexOf('?');
        String base = queryIndex >= 0 ? fileName.substring(0, queryIndex) : fileName;
        int lastSlash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
        String simpleName = lastSlash >= 0 ? base.substring(lastSlash + 1) : base;
        int lastDot = simpleName.lastIndexOf('.');
        if (lastDot < 0 || lastDot == simpleName.length() - 1) {
            return null;
        }
        return simpleName.substring(lastDot + 1).toLowerCase(Locale.ROOT);
    }


    public static final class FilePayload {

        private String fileId;

        private String fileUrl;

        private String fileName;

        public String getFileId() {
            return fileId;
        }

        public void setFileId(String fileId) {
            this.fileId = fileId;
        }

        public String getFileUrl() {
            return fileUrl;
        }

        public void setFileUrl(String fileUrl) {
            this.fileUrl = fileUrl;
        }

        public String getFileName() {
            return fileName;
        }

        public void setFileName(String fileName) {
            this.fileName = fileName;
        }
    }
}


