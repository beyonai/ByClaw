package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.alibaba.fastjson.JSONObject;

import com.iwhalecloud.byai.state.domain.showcase.ContentTypeConstant;
import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.ShowcaseRemoteExportService.ExportedFile;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Map;

@Slf4j
@Component
public class TextShowcaseStrategy extends BaseFileShowcaseStrategy {

    public static final String TYPE = "text";

    private final ShowcaseRemoteExportService remoteExportService;

    private final ShowcaseStorageHelper storageHelper;

    public TextShowcaseStrategy(ShowcaseRemoteExportService remoteExportService,
        ShowcaseStorageHelper storageHelper) {
        this.remoteExportService = remoteExportService;
        this.storageHelper = storageHelper;
    }

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    protected String fileExtension() {
        return ".docx";
    }

    @Override
    protected String mediaType() {
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }

    @Override
    protected ShowcaseStoragePayload downloadOriginalFile(ByaiShowcase showcase) {
        Long docId = resolveDocId(showcase);
        if (docId == null) {
            return buildFromContent(showcase);
        }
        //先设置file_code
        showcase.setFileCode(ContentTypeConstant.text + docId);
        if (recoverIfNecessary(showcase)) {
            return ShowcaseStoragePayload.empty();
        }
        ExportedFile exportedFile = remoteExportService.exportDoc(docId, "docx");
        if (exportedFile == null || exportedFile.isEmpty()) {
            return buildFromContent(showcase);
        }
        String fileName = exportedFile.getFileName();
        if (StringUtils.isBlank(fileName)) {
            fileName = buildFileName(showcase.getName());
        }
        String mediaTypeValue = StringUtils.defaultIfBlank(exportedFile.getMediaType(), mediaType());
        return ShowcaseStoragePayload.of(exportedFile.getData(), fileName, mediaTypeValue);
    }

    @Override
    protected ShowcaseStoragePayload uploadToObjectStorage(ByaiShowcase showcase,
        ShowcaseStoragePayload downloadedPayload) {
        return storageHelper.upload(showcase, downloadedPayload);
    }

    private ShowcaseStoragePayload buildFromContent(ByaiShowcase showcase) {
        byte[] data = showcase.getContent() == null ? new byte[0]
            : showcase.getContent().getBytes(StandardCharsets.UTF_8);
        String baseName = StringUtils.defaultIfBlank(showcase.getName(), "showcase");
        String fileName = baseName.endsWith(".txt") ? baseName : baseName + ".txt";
        return ShowcaseStoragePayload.of(data, fileName, "text/plain;charset=UTF-8");
    }

    /**
     * 从成果内容中解析 docId，优先使用 messageId 作为兜底。
     */
    private Long resolveDocId(ByaiShowcase showcase) {
        String content = showcase.getContent();
        if (StringUtils.isBlank(content)) {
            return showcase.getMessageId();
        }
        try {
            Map<String, Object> root = JSONObject.parseObject(content);
            Long docId = extractDocIdFromSubstance(root);
            if (docId != null) {
                return docId;
            }
        }
        catch (Exception parseException) {
            log.warn("解析文本成果 docId 失败 showcaseId={} content={}", showcase.getId(), showcase.getContent(),
                parseException);
        }
        return showcase.getMessageId();
    }

    private Long extractDocIdFromSubstance(Map<String, Object> root) {
        if (root == null || root.isEmpty()) {
            return null;
        }
        Object substanceObj = root.get("substance");
        if (!(substanceObj instanceof Map<?, ?> substance)) {
            return null;
        }
        return parseNumericId(substance.get("docId"));
    }

    private Long parseNumericId(Object value) {
        if (value == null) {
            return null;
        }
        String text = value.toString();
        if (StringUtils.isBlank(text)) {
            return null;
        }
        try {
            return Long.parseLong(text);
        }
        catch (NumberFormatException ex) {
            log.warn("无法解析文本成果 docId={}，保持忽略", text, ex);
            return null;
        }
    }
}

