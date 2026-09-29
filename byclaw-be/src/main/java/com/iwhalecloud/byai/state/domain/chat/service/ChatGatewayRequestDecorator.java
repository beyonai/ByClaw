package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Map;

/** Decorates only Gateway egress; stored user content and the stream protocol stay unchanged. */
public interface ChatGatewayRequestDecorator {
    Object decorate(ChatProcessContext context, Object content, Map<String, Object> gatewayParams);
}
