package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseStoragePayload;
import org.springframework.stereotype.Component;

@Component
public class ExcelShowcaseStrategy extends BaseFileShowcaseStrategy {

    public static final String TYPE = "excel";

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    protected String fileExtension() {
        return ".xlsx";
    }

    @Override
    protected String mediaType() {
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }

    @Override
    protected ShowcaseStoragePayload downloadOriginalFile(ByaiShowcase showcase) {
        // TODO: Excel类型后续如需自定义生成逻辑可在此补充
        return ShowcaseStoragePayload.empty();
    }

    @Override
    protected ShowcaseStoragePayload uploadToObjectStorage(ByaiShowcase showcase,
        ShowcaseStoragePayload downloadedPayload) {
        // Excel类型当前沿用已有URL，不触发上传
        return ShowcaseStoragePayload.withObjectUrl(showcase.getContent());
    }
}


