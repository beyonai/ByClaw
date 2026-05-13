package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDetailDto;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import org.springframework.stereotype.Component;

/**
 * 汇总类型策略，直接委托默认行为
 */
@Component
public class AllShowcaseStrategy extends AbstractShowcaseStrategy {

    public static final String TYPE = "all";

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    public ShowcaseDetailDto buildDetail(ByaiShowcase showcase) {
        return ShowcaseDetailDto.builder(showcase)
            .putAttribute("previewType", TYPE)
            .putAttribute("description", "展示全部成果概要")
            .build();
    }

    @Override
    protected ShowcaseStoragePayload downloadOriginalFile(ByaiShowcase showcase) {
        // TODO 后续实现汇总成果的下载逻辑，根据具体业务决定生成文件类型
        return ShowcaseStoragePayload.empty();
    }

    @Override
    protected ShowcaseStoragePayload uploadToObjectStorage(ByaiShowcase showcase,
        ShowcaseStoragePayload downloadedPayload) {
        // TODO 后续实现汇总成果上传对象存储的流程，返回最终访问地址
        return ShowcaseStoragePayload.withObjectUrl(showcase.getContent());
    }
}



