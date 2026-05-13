package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import org.springframework.stereotype.Component;

@Component
public class TaskShowcaseStrategy extends BaseFileShowcaseStrategy {

    public static final String TYPE = "task";

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    protected String fileExtension() {
        return ".json";
    }

    @Override
    protected String mediaType() {
        return "application/json";
    }

    protected ShowcaseStoragePayload downloadOriginalFile(ByaiShowcase showcase) {
        if (showcase == null) {
            throw new IllegalArgumentException(I18nUtil.get("showcase.strategy.showcase.cannot.be.null"));
        }
        // TODO 后续实现任务成果的下载逻辑，例如生成任务上下文的JSON文件
        return ShowcaseStoragePayload.empty();
    }

    protected ShowcaseStoragePayload uploadToObjectStorage(ByaiShowcase showcase,
                                                           ShowcaseStoragePayload downloadedPayload) {
        if (showcase == null || downloadedPayload == null) {
            throw new IllegalArgumentException(I18nUtil.get("showcase.strategy.showcase.and.downloaded.payload.cannot.be.null"));
        }
        // TODO 后续实现任务成果上传对象存储，并返回可访问的URL
        return ShowcaseStoragePayload.withObjectUrl(showcase.getContent());
    }
}

