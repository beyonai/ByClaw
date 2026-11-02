package com.iwhalecloud.byai.state.domain.notification.service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.embedded.EmbeddedChannel;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.test.util.ReflectionTestUtils;

class NotificationServiceIdentityTest {
    @Test
    void admittedPollUsesCapturedIdentityInsteadOfLaterChannelIdentity() {
        checkIdentity(true);
    }

    @Test
    void synchronousCallRetainsChannelIdentityFallback() {
        checkIdentity(false);
    }

    private void checkIdentity(boolean captured) {
        NotificationService service = new NotificationService();
        SandboxService sandbox = mock(SandboxService.class);
        ReflectionTestUtils.setField(service, "sandboxService", sandbox);
        EmbeddedChannel channel = new EmbeddedChannel();
        ChannelHandlerContext context = mock(ChannelHandlerContext.class);
        org.mockito.Mockito.when(context.channel()).thenReturn(channel);
        LoginInfo later = user(2L, "later");
        channel.attr(Constant.ATT_USER_INFO).set(later);
        try (MockedStatic<RedisUtil> redis = mockStatic(RedisUtil.class)) {
            if (captured) CurrentUserHolder.setLoginInfo(user(1L, "captured"));
            service.getRealTimeNotification(context, "{}");
            verify(sandbox).heartbeat(captured ? "captured" : "later", -1L);
            redis.verify(() -> RedisUtil.getString(captured ? "USER_NOTIFICATION_1" : "USER_NOTIFICATION_2"));
        }
        finally {
            CurrentUserHolder.clearLoginInfo();
            channel.finishAndReleaseAll();
        }
    }

    private LoginInfo user(Long id, String code) {
        LoginInfo user = new LoginInfo();
        user.setUserId(id);
        user.setUserCode(code);
        return user;
    }
}
