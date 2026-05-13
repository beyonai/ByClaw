package com.iwhalecloud.byai.state.infrastructure.messagecontent;

import com.iwhalecloud.byai.state.infrastructure.messagecontent.handle.DefaultContentHandler;
import com.iwhalecloud.byai.state.infrastructure.messagecontent.handle.EchartContentHandler;
import com.iwhalecloud.byai.state.infrastructure.messagecontent.handle.MessageContentHandler;
import com.iwhalecloud.byai.state.infrastructure.messagecontent.handle.WriterArticleContentHandler;
import com.iwhalecloud.byai.state.infrastructure.messagecontent.handle.WriterOutlineContentHandler;
import com.iwhalecloud.byai.state.common.enums.MessageContentTypeEnum;

import java.util.HashMap;
import java.util.Map;

/**
 * @author zht
 * @version 1.0
 * @date 2025/6/10
 */
public class MessageContentHandlerFactory {

    private static final Map<String, MessageContentHandler> handlers = new HashMap<>();

    static {
        handlers.put(MessageContentTypeEnum.ECHART.getCode(), new EchartContentHandler());
        handlers.put(MessageContentTypeEnum.WRITER_ARTICLE.getCode(), new WriterArticleContentHandler());
        handlers.put(MessageContentTypeEnum.WRITER_OUTLINE.getCode(), new WriterOutlineContentHandler());
    }

    public static MessageContentHandler getHandler(String contentType) {
        return handlers.getOrDefault(contentType, new DefaultContentHandler());
    }
}
