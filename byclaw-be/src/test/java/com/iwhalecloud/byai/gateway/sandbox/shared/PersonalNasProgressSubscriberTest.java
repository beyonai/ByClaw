package com.iwhalecloud.byai.gateway.sandbox.shared;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class PersonalNasProgressSubscriberTest {
    @Test void onlyMatchingAuthenticatedPersonalChannelsReceiveMinimalWakeup() {
        ChannelManager channels=mock(ChannelManager.class);
        EmbeddedChannel alice=new EmbeddedChannel(),bob=new EmbeddedChannel(),tenant=new EmbeddedChannel();
        LoginInfo a=new LoginInfo();a.setUserCode("alice");LoginInfo b=new LoginInfo();b.setUserCode("bob");
        alice.attr(Constant.ATT_USER_INFO).set(a);bob.attr(Constant.ATT_USER_INFO).set(b);
        tenant.attr(Constant.ATT_USER_INFO).set(a);tenant.attr(Constant.ATT_ENTERPRISE_ID).set("42");
        when(channels.getAllUserIds()).thenReturn(Set.of(1L,2L));
        when(channels.getChannels(1L)).thenReturn(Set.of(alice,tenant));when(channels.getChannels(2L)).thenReturn(Set.of(bob));
        PersonalNasProgressSubscriber subscriber=new PersonalNasProgressSubscriber(mock(RedisMessageListenerContainer.class),channels,new ObjectMapper(),"byai");
        String event="{\"type\":\"STORAGE_PREPARATION\",\"userCode\":\"alice\",\"taskId\":\""+"a".repeat(64)+"\",\"version\":9,\"status\":\"READY\",\"quotaPath\":\"SECRET_PATH\"}";
        try {
            subscriber.accept(event);
            TextWebSocketFrame frame=alice.readOutbound();
            assertThat(frame.text()).contains("STORAGE_PREPARATION","\"version\":9").doesNotContain("SECRET_PATH","userCode");frame.release();
            assertThat((Object)bob.readOutbound()).isNull();assertThat((Object)tenant.readOutbound()).isNull();
            subscriber.accept(event.replace("alice",""));subscriber.accept("{}");
            assertThat((Object)alice.readOutbound()).isNull();
        } finally {alice.finishAndReleaseAll();bob.finishAndReleaseAll();tenant.finishAndReleaseAll();}
    }
}
