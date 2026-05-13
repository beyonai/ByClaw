package com.iwhalecloud.byai.state.domain.showcase.strategy;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDetailDto;
import org.springframework.stereotype.Component;

@Component
public class ChatShowcaseStrategy extends AbstractShowcaseStrategy {

    public static final String TYPE = "chat";

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    public ShowcaseDetailDto buildDetail(ByaiShowcase showcase) {
        return ShowcaseDetailDto.builder(showcase)
            .putAttribute("previewType", TYPE)
            .putAttribute("messageSummary", buildBasicSummary(showcase.getContent()))
            .build();
    }

    private String buildBasicSummary(String content) {
        if (content == null) {
            return "";
        }
        String sanitized = content.replaceAll("\\s+", " ");
        if (sanitized.length() > 200) {
            return sanitized.substring(0, 200) + "...";
        }
        return sanitized;
    }

    @Override
    public void beforeSave(ByaiShowcase showcase) {
        // 对于聊天成果，直接保存数据库中的原始内容，无需下载或上传对象存储
    }
}



