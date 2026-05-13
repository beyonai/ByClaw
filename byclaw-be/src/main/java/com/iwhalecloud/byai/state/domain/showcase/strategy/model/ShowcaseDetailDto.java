package com.iwhalecloud.byai.state.domain.showcase.strategy.model;

import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * 成果空间详情数据传输对象
 */
public final class ShowcaseDetailDto {


    private final ByaiShowcase baseInfo;

    private final Map<String, Object> attributes;

    private ShowcaseDetailDto(ByaiShowcase baseInfo, Map<String, Object> attributes) {
        this.baseInfo = baseInfo;
        this.attributes = attributes == null ? Collections.emptyMap() : Collections.unmodifiableMap(attributes);
    }

    public static ShowcaseDetailDto basicOf(ByaiShowcase showcase) {
        return new ShowcaseDetailDto(showcase, Collections.emptyMap());
    }

    public static Builder builder(ByaiShowcase showcase) {
        return new Builder(showcase);
    }

    public ByaiShowcase getBaseInfo() {
        return baseInfo;
    }

    public Map<String, Object> getAttributes() {
        return attributes;
    }

    public static class Builder {

        private final ByaiShowcase showcase;

        private final Map<String, Object> attributes = new HashMap<>();

        public Builder(ByaiShowcase showcase) {
            this.showcase = showcase;
        }

        public Builder putAttribute(String key, Object value) {
            if (key != null && value != null) {
                attributes.put(key, value);
            }
            return this;
        }

        public ShowcaseDetailDto build() {
            return new ShowcaseDetailDto(showcase, attributes);
        }
    }
}




