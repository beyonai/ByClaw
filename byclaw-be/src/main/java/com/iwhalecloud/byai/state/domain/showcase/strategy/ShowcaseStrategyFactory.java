package com.iwhalecloud.byai.state.domain.showcase.strategy;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 成果空间策略工厂
 */
@Component
public class ShowcaseStrategyFactory {

    private final Map<String, ShowcaseStrategy> strategyMap;

    private final ShowcaseStrategy defaultStrategy;

    public ShowcaseStrategyFactory(List<ShowcaseStrategy> strategies) {
        Map<String, ShowcaseStrategy> map = new HashMap<>();
        ShowcaseStrategy defaultStrategyCandidate = null;
        for (ShowcaseStrategy strategy : strategies) {
            if (StringUtils.equalsIgnoreCase(strategy.getType(), DefaultShowcaseStrategy.TYPE)) {
                defaultStrategyCandidate = strategy;
            }
            if (strategy.getType() != null) {
                map.put(strategy.getType().toLowerCase(), strategy);
            }
        }
        this.strategyMap = Collections.unmodifiableMap(map);
        this.defaultStrategy = defaultStrategyCandidate != null ? defaultStrategyCandidate
            : new DefaultShowcaseStrategy();
    }

    /**
     * 根据类型获取策略
     *
     * @param type 成果类型
     * @return 对应策略，找不到时返回默认策略
     */
    public ShowcaseStrategy getStrategy(String type) {
        if (StringUtils.isBlank(type)) {
            return defaultStrategy;
        }
        String normalized = type.toLowerCase();
        if ("table".equals(normalized)) {
            normalized = ExcelShowcaseStrategy.TYPE;
        }
        return strategyMap.getOrDefault(normalized, defaultStrategy);
    }
}





