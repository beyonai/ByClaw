package com.iwhalecloud.byai.state.infrastructure.messagecontent.handle;

/**
 * @author zht
 * @version 1.0
 * @date 2025/6/10
 */
public final class DefaultContentHandler implements MessageContentHandler {
    @Override
    public String handle(String content) {
        return content;
    }
}
