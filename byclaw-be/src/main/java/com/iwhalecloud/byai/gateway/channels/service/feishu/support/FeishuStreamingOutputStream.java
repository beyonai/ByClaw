package com.iwhalecloud.byai.gateway.channels.service.feishu.support;

import java.io.IOException;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuReplyDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.util.StringUtils;

/**
 * 飞书机器人流式卡片输出流。
 *
 * <p>底层聊天服务会把 answerDelta/reasoningLogDelta 等事件持续写入 OutputStream。
 * 本类复用 {@link FeishuBufferedOutputStream} 的事件解析与内容累积能力，在每次内容变化后
 * 调用飞书「更新消息」接口覆盖同一张机器人卡片，从用户视角接近钉钉卡片的流式更新。</p>
 */
public class FeishuStreamingOutputStream extends FeishuBufferedOutputStream {

    private static final Logger logger = LoggerFactory.getLogger(FeishuStreamingOutputStream.class);

    private static final String DEFAULT_FALLBACK_REPLY = "抱歉，遇到了点问题，请稍后再试";
    /**
     * 飞书更新消息接口频率不宜太高；这里做轻量节流，避免每个 token 都发一次 HTTP 请求。
     * 200ms 能保持接近打字机的观感，同时比逐字更新更不容易触发飞书接口频控。
     */
    private static final long MIN_UPDATE_INTERVAL_MILLIS = 200L;

    private final FeishuReplyDispatcher feishuReplyDispatcher;
    private final String tenantAccessToken;
    private final String streamMessageId;
    private final String cardTitle;
    private long lastUpdateTimeMillis;
    private String lastSentContent = "";
    private boolean updateFailed;

    public FeishuStreamingOutputStream(
            ObjectMapper objectMapper,
            FeishuReplyDispatcher feishuReplyDispatcher,
            String tenantAccessToken,
            String streamMessageId,
            String cardTitle
    ) {
        this(objectMapper, feishuReplyDispatcher, tenantAccessToken, streamMessageId, cardTitle, true);
    }

    public FeishuStreamingOutputStream(
            ObjectMapper objectMapper,
            FeishuReplyDispatcher feishuReplyDispatcher,
            String tenantAccessToken,
            String streamMessageId,
            String cardTitle,
            boolean showReasoning
    ) {
        super(objectMapper, showReasoning);
        this.feishuReplyDispatcher = feishuReplyDispatcher;
        this.tenantAccessToken = tenantAccessToken;
        this.streamMessageId = streamMessageId;
        this.cardTitle = cardTitle;
    }

    @Override
    protected synchronized void onDisplayContentChanged(String displayContent) {
        if (updateFailed || !StringUtils.hasText(displayContent) || displayContent.equals(lastSentContent)) {
            return;
        }

        long now = System.currentTimeMillis();
        if (now - lastUpdateTimeMillis < MIN_UPDATE_INTERVAL_MILLIS) {
            return;
        }

        updateMessage(displayContent, false);
    }

    /**
     * chat() 结束后补一次最终更新，保证被节流跳过的最后一段内容也能显示到飞书里。
     */
    public synchronized void finish() {
        String displayContent = getDisplayContent();
        updateMessage(StringUtils.hasText(displayContent) ? displayContent : DEFAULT_FALLBACK_REPLY, true);
    }

    public boolean hasUpdateFailed() {
        return updateFailed;
    }

    private void updateMessage(String displayContent, boolean finalUpdate) {
        if (updateFailed || !StringUtils.hasText(streamMessageId) || displayContent.equals(lastSentContent)) {
            return;
        }

        try {
            feishuReplyDispatcher.updateCardMessage(tenantAccessToken, streamMessageId, cardTitle, displayContent);
            lastSentContent = displayContent;
            lastUpdateTimeMillis = System.currentTimeMillis();
        } catch (IOException e) {
            updateFailed = true;
            logger.warn("Update Feishu streaming message failed. messageId={}, finalUpdate={}",
                    streamMessageId, finalUpdate, e);
        }
    }
}
