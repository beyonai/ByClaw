package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDetailDto;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;

import java.nio.charset.StandardCharsets;

/**
 * 成果空间策略基础实现
 */
public abstract class AbstractShowcaseStrategy implements ShowcaseStrategy {

    @Autowired(required = false)
    private ShowcaseRecoveryHelper showcaseRecoveryHelper;

    @Override
    public void beforeSave(ByaiShowcase showcase) {
        // 下载原始材料，供后续上传使用
        ShowcaseStoragePayload downloadedPayload = downloadOriginalFile(showcase);
        // 上传至对象存储，生成可访问的URL
        ShowcaseStoragePayload uploadedPayload = uploadToObjectStorage(showcase, downloadedPayload);
        // 将上传结果写回实体，保证数据库存储的是统一的地址信息
        applyStorageResult(showcase, downloadedPayload, uploadedPayload);
    }

    protected ShowcaseDetailDto buildBasicDetail(ByaiShowcase showcase, String description) {
        if (showcase == null) {
            throw new IllegalArgumentException(I18nUtil.get("showcase.strategy.showcase.cannot.be.null"));
        }
        return ShowcaseDetailDto.builder(showcase)
            .putAttribute("typeDescription", description)
            .putAttribute("contentPreview", abbreviate(showcase.getContent(), 200))
            .build();
    }

    protected byte[] toBytes(String content) {
        if (content == null) {
            return new byte[0];
        }
        return content.getBytes(StandardCharsets.UTF_8);
    }

    private String abbreviate(String text, int maxLength) {
        if (StringUtils.isBlank(text)) {
            return "";
        }
        if (text.length() <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + "...";
    }

    /**
     * 下载原始成果文件。
     *
     * <p>默认返回空载体，各具体策略按需覆盖。</p>
     */
    protected ShowcaseStoragePayload downloadOriginalFile(ByaiShowcase showcase) {
        return ShowcaseStoragePayload.empty();
    }

    /**
     * 将成果上传至对象存储。
     *
     * <p>默认直接返回输入载体，具体策略可在此处完成上传逻辑，并在返回值中携带 MinIO 等对象存储的访问地址。</p>
     */
    protected ShowcaseStoragePayload uploadToObjectStorage(ByaiShowcase showcase,
        ShowcaseStoragePayload downloadedPayload) {
        return downloadedPayload == null ? ShowcaseStoragePayload.empty() : downloadedPayload;
    }

    /**
     * 将上传结果写回成果实体。
     *
     * <p>默认使用返回载体中的对象存储地址覆盖 content 字段，避免后续流程继续使用原始内容。</p>
     */
    protected void applyStorageResult(ByaiShowcase showcase, ShowcaseStoragePayload downloadedPayload,
        ShowcaseStoragePayload uploadedPayload) {
        if (uploadedPayload == null || uploadedPayload.isEmpty()) {
            return;
        }
        if (StringUtils.isNotBlank(uploadedPayload.getObjectUrl())) {
            showcase.setUrl(uploadedPayload.getObjectUrl());
        }
        if (StringUtils.isNotBlank(uploadedPayload.getFileName())) {
            showcase.setName(uploadedPayload.getFileName());
        }
        if (StringUtils.isNotBlank(uploadedPayload.getFileId())) {
            showcase.setFileId(uploadedPayload.getFileId());
        }
        if (StringUtils.isNotBlank(uploadedPayload.getFileCode())) {
            showcase.setFileCode(uploadedPayload.getFileCode());
        }
    }

    protected boolean recoverIfNecessary(ByaiShowcase showcase) {
        if (showcaseRecoveryHelper == null) {
            return false;
        }
        return showcaseRecoveryHelper.recoverIfNecessary(showcase);
    }
}



