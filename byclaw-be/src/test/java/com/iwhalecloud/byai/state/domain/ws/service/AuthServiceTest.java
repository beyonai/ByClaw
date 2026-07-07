package com.iwhalecloud.byai.state.domain.ws.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicReference;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.BaseTokenFilter;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.DefaultFullHttpRequest;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.HttpMethod;
import io.netty.handler.codec.http.HttpVersion;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

class AuthServiceTest {

    @AfterEach
    void tearDown() {
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void authCopiesUrlLanguageToHeadersAndAppliesLocaleAfterJwtVerification() {
        JwtService jwtService = mock(JwtService.class);
        ChannelManager channelManager = mock(ChannelManager.class);
        BaseTokenFilter baseTokenFilter = mock(BaseTokenFilter.class);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(10L);
        loginInfo.setUserCode("u10");
        loginInfo.setUserName("tester");
        when(jwtService.verifyJwt(eq("token-1"), eq(LoginInfo.class))).thenReturn(loginInfo);
        when(baseTokenFilter.createSsoToken("u10")).thenReturn("sso-1");

        AuthService authService = new AuthService();
        ReflectionTestUtils.setField(authService, "jwtService", jwtService);
        ReflectionTestUtils.setField(authService, "channelManager", channelManager);
        ReflectionTestUtils.setField(authService, "baseTokenFilter", baseTokenFilter);

        EmbeddedChannel channel = embeddedChannel();
        ChannelHandlerContext ctx = channel.pipeline().firstContext();
        FullHttpRequest request = new DefaultFullHttpRequest(HttpVersion.HTTP_1_1, HttpMethod.GET,
            "/byaiService/ws?beyond-token=token-1&language=en-US");

        authService.auth(ctx, request);

        assertThat(request.headers().get("language")).isEqualTo("en-US");
        assertThat(request.headers().get("sso-token")).isEqualTo("sso-1");
        assertThat(channel.attr(Constant.ATT_USER_INFO).get()).isSameAs(loginInfo);
        assertThat(loginInfo.getParamMap()).containsEntry("language", "en-US");
        assertThat(LocaleContextHolder.getLocale()).isEqualTo(Locale.US);
        verify(channelManager).addChannel(10L, channel);
    }

    private EmbeddedChannel embeddedChannel() {
        AtomicReference<ChannelHandlerContext> context = new AtomicReference<>();
        EmbeddedChannel channel = new EmbeddedChannel(new ChannelInboundHandlerAdapter() {
            @Override
            public void handlerAdded(ChannelHandlerContext ctx) {
                context.set(ctx);
            }
        });
        assertThat(context.get()).isNotNull();
        return channel;
    }
}
