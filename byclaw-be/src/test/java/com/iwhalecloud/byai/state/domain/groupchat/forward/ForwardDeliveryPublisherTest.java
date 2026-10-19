package com.iwhalecloud.byai.state.domain.groupchat.forward;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.ForwardDeliveryPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.Delivery;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.alibaba.fastjson.JSONObject;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.*;
class ForwardDeliveryPublisherTest {
    @Test void recalledBeforeRetryNeverRebroadcastsBody(){
        var events=mock(GroupChatEventPublisher.class);var publisher=new ForwardDeliveryPublisher(events);
        publisher.publish(new Delivery(3,1,20,List.of(Map.of("messageId","901","recalled",true,"content","消息已撤回")),List.of(31L)));
        var captor=org.mockito.ArgumentCaptor.forClass(JSONObject.class);verify(events).publishForwardMembers(eq(1L),eq(List.of(31L)),captor.capture());
        assertThat(captor.getValue().getString("event")).isEqualTo("MESSAGE_RECALLED");assertThat(captor.getValue().toJSONString()).doesNotContain("originalBody");
    }
    @Test void boundRecipientsUseExactEnterpriseAndObservableWriteFailure() {
        var channels=mock(com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager.class);
        var publisher=new GroupChatEventPublisher(mock(com.iwhalecloud.byai.state.domain.session.service.SessionMemberService.class),channels);
        var chosen=new io.netty.channel.embedded.EmbeddedChannel();var other=new io.netty.channel.embedded.EmbeddedChannel();
        chosen.attr(com.iwhalecloud.byai.state.domain.ws.constant.Constant.ATT_ENTERPRISE_ID).set("1");other.attr(com.iwhalecloud.byai.state.domain.ws.constant.Constant.ATT_ENTERPRISE_ID).set("2");
        when(channels.getChannels(31L)).thenReturn(Set.of(chosen,other));
        try{publisher.publishForwardMembers(1,List.of(31L),new JSONObject(new HashMap<>(Map.of("messageId","901"))));var frame=(io.netty.handler.codec.http.websocketx.TextWebSocketFrame)chosen.readOutbound();assertThat(frame.text()).contains("901");frame.release();assertThat((Object)other.readOutbound()).isNull();}finally{chosen.finishAndReleaseAll();other.finishAndReleaseAll();}
        var failing=new io.netty.channel.embedded.EmbeddedChannel(new io.netty.channel.ChannelOutboundHandlerAdapter(){@Override public void write(io.netty.channel.ChannelHandlerContext ctx,Object message,io.netty.channel.ChannelPromise promise){io.netty.util.ReferenceCountUtil.release(message);promise.setFailure(new IllegalStateException("private transport detail"));}});
        failing.attr(com.iwhalecloud.byai.state.domain.ws.constant.Constant.ATT_ENTERPRISE_ID).set("1");when(channels.getChannels(31L)).thenReturn(Set.of(failing));
        try{assertThatThrownBy(()->publisher.publishForwardMembers(1,List.of(31L),new JSONObject())).hasMessage("FORWARD_DELIVERY_UNAVAILABLE");}finally{failing.finishAndReleaseAll();}
    }

}
