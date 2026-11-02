package com.iwhalecloud.byai.gateway.sandbox.shared;

import com.fasterxml.jackson.databind.*;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;
import io.netty.channel.Channel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import jakarta.annotation.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.*;
import org.springframework.data.redis.listener.*;
import org.springframework.stereotype.Component;

/** Each BE sends only to its own authenticated channels; never republishes the event. */
@Component
public class PersonalNasProgressSubscriber implements MessageListener {
    private final RedisMessageListenerContainer container;
    private final ChannelManager channels;
    private final ObjectMapper json;
    private final ChannelTopic topic;
    public PersonalNasProgressSubscriber(RedisMessageListenerContainer container,ChannelManager channels,
            ObjectMapper json,@Value("${DB_SCHEMA:byai}") String schema) {
        if(!schema.matches("[A-Za-z_][A-Za-z0-9_]*"))throw new IllegalArgumentException("Invalid storage schema");
        this.container=container;this.channels=channels;this.json=json;
        this.topic=new ChannelTopic(schema+":nas:preparation:events");
    }
    @PostConstruct public void start(){container.addMessageListener(this,topic);}
    @PreDestroy public void stop(){container.removeMessageListener(this,topic);}
    public void onMessage(Message message,byte[] pattern){accept(new String(message.getBody(),StandardCharsets.UTF_8));}
    public void accept(String raw) {
        if(raw==null || raw.length()>8192)return;
        final JsonNode event;
        final String frame;
        try {
            event=json.readTree(raw);
            if(event==null || !"STORAGE_PREPARATION".equals(event.path("type").asText())
                    || !event.path("userCode").asText().matches("[A-Za-z0-9_-]{1,128}")
                    || !event.path("taskId").asText().matches("[a-f0-9]{64}")
                    || !event.path("version").isIntegralNumber() || event.path("version").asLong(-1)<0)return;
            String status=event.path("status").asText();
            if(!Set.of("PENDING","ALLOCATING","PREPARING","PENDING_QUOTA","READY","ERROR","MIGRATING").contains(status))return;
            frame=json.writeValueAsString(Map.of("type","STORAGE_PREPARATION","data",Map.of(
                "taskId",event.path("taskId").asText(),"version",event.path("version").asLong(),"status",status)));
        } catch(Exception invalid){return;}
        String owner=event.path("userCode").asText();
        for(Long id:channels.getAllUserIds())for(Channel channel:channels.getChannels(id)) {
            LoginInfo user=channel.attr(Constant.ATT_USER_INFO).get();
            String tenant=channel.attr(Constant.ATT_ENTERPRISE_ID).get();
            if(channel.isActive() && user!=null && owner.equals(user.getUserCode()) && (tenant==null || tenant.isBlank()))
                channel.writeAndFlush(new TextWebSocketFrame(frame));
        }
    }
}
