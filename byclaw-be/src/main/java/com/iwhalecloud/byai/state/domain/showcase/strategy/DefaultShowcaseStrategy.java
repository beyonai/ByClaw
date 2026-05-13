package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDetailDto;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import org.springframework.stereotype.Component;

/**
 * 默认成果空间策略
 */
@Component
public class DefaultShowcaseStrategy extends AbstractShowcaseStrategy {

    public static final String TYPE = "default";

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    public ShowcaseDetailDto buildDetail(ByaiShowcase showcase) {
        return buildBasicDetail(showcase, "通用成果类型");
    }

    @Override
    protected ShowcaseStoragePayload downloadOriginalFile(ByaiShowcase showcase) {
        // TODO 后续实现默认成果的下载逻辑，当前占位保持原内容
        return ShowcaseStoragePayload.empty();
    }

    @Override
    protected ShowcaseStoragePayload uploadToObjectStorage(ByaiShowcase showcase,
        ShowcaseStoragePayload downloadedPayload) {
        // TODO 后续实现默认成果上传对象存储的逻辑，暂时回写原始内容
        return ShowcaseStoragePayload.withObjectUrl(showcase.getContent());
    }
}



