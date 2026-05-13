package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import org.springframework.stereotype.Component;

@Component
public class PaperShowcaseStrategy extends BaseFileShowcaseStrategy {

    public static final String TYPE = "paper";

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    protected String fileExtension() {
        return ".pdf";
    }

    @Override
    protected String mediaType() {
        return "application/pdf";
    }

    @Override
    protected ShowcaseStoragePayload downloadOriginalFile(ByaiShowcase showcase) {
        // TODO 后续实现文档成果的下载逻辑，例如从资料库拉取PDF文件
        return ShowcaseStoragePayload.empty();
    }

    @Override
    protected ShowcaseStoragePayload uploadToObjectStorage(ByaiShowcase showcase,
        ShowcaseStoragePayload downloadedPayload) {
        // TODO 后续实现文档成果上传至对象存储，并返回在线浏览地址
        return ShowcaseStoragePayload.withObjectUrl(showcase.getContent());
    }
}

