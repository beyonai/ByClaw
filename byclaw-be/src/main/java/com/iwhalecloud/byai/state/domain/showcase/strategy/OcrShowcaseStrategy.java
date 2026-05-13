package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
public class OcrShowcaseStrategy extends BaseFileShowcaseStrategy {

    public static final String TYPE = "ocr";

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
        // TODO 后续实现OCR成果的下载逻辑，例如从识别结果生成文本文件
        byte[] data = showcase.getContent() == null ? new byte[0] :
            showcase.getContent().getBytes(StandardCharsets.UTF_8);
        return ShowcaseStoragePayload.of(data, showcase.getName(), mediaType());
    }

    @Override
    protected ShowcaseStoragePayload uploadToObjectStorage(ByaiShowcase showcase,
        ShowcaseStoragePayload downloadedPayload) {
        // TODO 后续实现OCR成果上传对象存储的逻辑，返回最终访问地址
        String content = showcase.getContent();
        if (content == null) {
            throw new IllegalArgumentException(I18nUtil.get("showcase.strategy.showcase.content.cannot.be.null"));
        }
        return ShowcaseStoragePayload.withObjectUrl(content);
    }
}

