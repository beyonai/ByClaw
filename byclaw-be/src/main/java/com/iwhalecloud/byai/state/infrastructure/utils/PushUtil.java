package com.iwhalecloud.byai.state.infrastructure.utils;

import io.netty.channel.Channel;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public final class PushUtil {
    private PushUtil() {
    }

    /**
     * 向指定Netty通道发送WebSocket消息帧。
     *
     * @param channel Netty通道
     * @param frame WebSocket消息帧
     */
    // TODO:目前简单做，需要涉及到推送量过大的时候控制速率
    public static void sendMessageToChannel(Channel channel, Object frame) {
        if (isChannelValid(channel)){
            try {
                channel.writeAndFlush(frame);
            }
            catch (Exception e) {
                log.error("Failed to send message to channel", e);
            }
        }
        else {
            log.warn("current channel is dead");
        }
    }

    /**
     * 判断Netty通道是否有效。
     *
     * @param channel Netty通道
     * @return 通道有效返回true，否则返回false
     */
    private static boolean isChannelValid(Channel channel) {
        return channel != null && channel.isActive();
    }
}
