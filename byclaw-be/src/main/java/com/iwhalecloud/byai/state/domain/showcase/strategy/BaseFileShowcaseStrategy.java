package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDetailDto;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDownloadResult;
import org.apache.commons.lang3.StringUtils;

/**
 * 基础文件型成果策略
 */
public abstract class BaseFileShowcaseStrategy extends AbstractShowcaseStrategy {

    @Override
    public ShowcaseDetailDto buildDetail(ByaiShowcase showcase) {
        return ShowcaseDetailDto.builder(showcase)
            .putAttribute("previewType", getType())
            .putAttribute("fileExtension", fileExtension())
            .putAttribute("contentPreview", buildPreview(showcase.getContent()))
            .build();
    }

    @Override
    public ShowcaseDownloadResult download(ByaiShowcase showcase) {
        byte[] data = toBytes(showcase.getContent());
        String fileName = buildFileName(showcase.getName());
        return ShowcaseDownloadResult.of(data, fileName, mediaType());
    }

    protected String buildFileName(String originalName) {
        String baseName = StringUtils.isBlank(originalName) ? "showcase" : originalName;
        // 清理文件名中的路径分隔符
        baseName = baseName.replaceAll("[/\\\\]", "_");
        if (baseName.endsWith(fileExtension())) {
            return baseName;
        }
        return baseName + fileExtension();
    }

    protected String buildPreview(String content) {
        return content == null ? "" : content;
    }

    /**
     * 获取文件扩展名，包含点号
     */
    protected abstract String fileExtension();

    /**
     * 获取Content-Type
     */
    protected abstract String mediaType();
}



