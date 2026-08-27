package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model;

import java.util.List;

public record RobotConfigParseResult(
        List<DingtalkRobotChannelConfig> configs,
        boolean hasDingtalkNode,
        List<ParseError> errors
) {

    public RobotConfigParseResult {
        configs = configs == null ? List.of() : List.copyOf(configs);
        errors = errors == null ? List.of() : List.copyOf(errors);
    }

    public record ParseError(String code, String robotCode) {
    }
}
