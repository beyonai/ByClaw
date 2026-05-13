package com.iwhalecloud.byai.state.interfaces.controller.showcase.dto;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.state.domain.showcase.strategy.model.ShowcaseDetailDto;

import java.util.Map;

/**
 * 成果空间详情响应
 */
public class ShowcaseDetailResponse {

    private ByaiShowcase baseInfo;

    private Map<String, Object> attributes;

    public static ShowcaseDetailResponse from(ShowcaseDetailDto dto) {
        ShowcaseDetailResponse response = new ShowcaseDetailResponse();
        response.setBaseInfo(dto.getBaseInfo());
        response.setAttributes(dto.getAttributes());
        return response;
    }

    public ByaiShowcase getBaseInfo() {
        return baseInfo;
    }

    public void setBaseInfo(ByaiShowcase baseInfo) {
        this.baseInfo = baseInfo;
    }

    public Map<String, Object> getAttributes() {
        return attributes;
    }

    public void setAttributes(Map<String, Object> attributes) {
        this.attributes = attributes;
    }
}




