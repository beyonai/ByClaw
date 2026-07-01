package com.iwhalecloud.byai.state.infrastructure.utils;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;

import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.util.Attribute;

class CloseUtilTest {

    @Test
    void closeClosesUnauthenticatedChannelWithoutUserInfo() {
        ChannelHandlerContext ctx = mock(ChannelHandlerContext.class);
        Channel channel = mock(Channel.class);
        Attribute<LoginInfo> channelUserInfo = mock(Attribute.class);
        Attribute<LoginInfo> contextUserInfo = mock(Attribute.class);

        when(ctx.channel()).thenReturn(channel);
        when(channel.attr(Constant.ATT_USER_INFO)).thenReturn(channelUserInfo);
        when(ctx.attr(Constant.ATT_USER_INFO)).thenReturn(contextUserInfo);
        when(channelUserInfo.get()).thenReturn(null);
        when(contextUserInfo.get()).thenReturn(null);

        CloseUtil.close(ctx);

        verify(ctx).close();
    }
}
