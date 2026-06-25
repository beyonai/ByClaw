package com.iwhalecloud.byai.state.domain.ws.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.BaseTokenFilter;

import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.DefaultFullHttpRequest;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.HttpMethod;
import io.netty.handler.codec.http.HttpVersion;

class AuthServiceTest {

    @Test
    void authStoresGeneratedSsoTokenInLoginInfoParamMap() {
        JwtService jwtService = mock(JwtService.class);
        ChannelManager channelManager = mock(ChannelManager.class);
        BaseTokenFilter baseTokenFilter = mock(BaseTokenFilter.class);

        AuthService authService = new AuthService();
        ReflectionTestUtils.setField(authService, "jwtService", jwtService);
        ReflectionTestUtils.setField(authService, "channelManager", channelManager);
        ReflectionTestUtils.setField(authService, "baseTokenFilter", baseTokenFilter);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(100L);
        loginInfo.setUserCode("u001");
        when(jwtService.verifyJwt("jwt-token", LoginInfo.class)).thenReturn(loginInfo);
        when(baseTokenFilter.createSsoToken("u001")).thenReturn("generated-sso-token");

        FullHttpRequest request = new DefaultFullHttpRequest(HttpVersion.HTTP_1_1, HttpMethod.GET,
            "/byaiService/ws?beyond-token=jwt-token");
        Channel channel = new EmbeddedChannel();
        ChannelHandlerContext ctx = mock(ChannelHandlerContext.class);
        when(ctx.channel()).thenReturn(channel);

        authService.auth(ctx, request);

        LoginInfo storedLoginInfo = channel.attr(Constant.ATT_USER_INFO).get();
        Map<String, String> storedHeaders = channel.attr(Constant.ATT_HEADER).get();
        assertSame(loginInfo, storedLoginInfo);
        assertEquals("jwt-token", storedLoginInfo.getParamMap().get("beyond-token"));
        assertEquals("generated-sso-token", storedLoginInfo.getParamMap().get("sso-token"));
        assertEquals("generated-sso-token", storedHeaders.get("sso-token"));
        assertEquals("generated-sso-token", request.headers().get("sso-token"));
        verify(channelManager).addChannel(100L, channel);
    }
}
