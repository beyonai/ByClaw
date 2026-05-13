package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.showcase.ContentTypeConstant;
import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;

import com.iwhalecloud.byai.state.domain.showcase.strategy.ShowcaseRemoteExportService.ExportedFile;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;

import java.util.Map;

@Slf4j
@Component
public class PptShowcaseStrategy extends BaseFileShowcaseStrategy {

    public static final String TYPE = "ppt";

    private final ShowcaseRemoteExportService remoteExportService;

    private final ShowcaseStorageHelper storageHelper;

    public PptShowcaseStrategy(ShowcaseRemoteExportService remoteExportService,
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
        return ".pptx";
    }

    @Override
    protected String mediaType() {
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    }

    @Override
    protected ShowcaseStoragePayload downloadOriginalFile(ByaiShowcase showcase) {
        Long pptId = resolvePptId(showcase);
        if (pptId == null) {
            log.warn("PPT成果未提供导出ID，跳过导出 showcaseId={}", showcase.getId());
            return ShowcaseStoragePayload.empty();
        }
        //先设置file_code
        showcase.setFileCode(ContentTypeConstant.ppt + pptId);
        if (recoverIfNecessary(showcase)) {
            return ShowcaseStoragePayload.empty();
        }

        ExportedFile exportedFile = remoteExportService.exportPpt(pptId);
        if (exportedFile == null || exportedFile.isEmpty()) {
            log.warn("PPT导出结果为空 showcaseId={} pptId={}", showcase.getId(), pptId);
            return ShowcaseStoragePayload.empty();
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

    private Long resolvePptId(ByaiShowcase showcase) {
        String content = showcase.getContent();
        if (StringUtils.isBlank(content)) {
            return showcase.getMessageId();
        }
        try {
            Map<String, Object> root = JSONObject.parseObject(content);
            Long pptId = extractPptIdFromSubstance(root);
            if (pptId != null) {
                return pptId;
            }
        }
        catch (Exception ex) {
            log.warn("解析PPT成果pptId失败 showcaseId={} content={}", showcase.getId(), showcase.getContent(), ex);
        }
        return showcase.getMessageId();
    }

    private Long extractPptIdFromSubstance(Map<String, Object> root) {
        if (root == null || root.isEmpty()) {
            return null;
        }
        Object substanceObj = root.get("substance");
        if (!(substanceObj instanceof Map<?, ?> substance)) {
            return null;
        }
        return parseNumericId(substance.get("pptId"));
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
            log.warn("无法解析PPT成果ID={}，保持忽略", text, ex);
            return null;
        }
    }
}

