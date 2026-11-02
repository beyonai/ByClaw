package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.Delivery;
import org.springframework.stereotype.Component;
/** Fresh current projections are enqueued by committed message ID; no frozen event body is retained. */
@Component
public class ForwardDeliveryPublisher {
    private final GroupChatEventPublisher events;
    public ForwardDeliveryPublisher(GroupChatEventPublisher events){this.events=events;}
    public void publish(Delivery delivery){
        if(delivery==null||delivery.messages().size()!=1)throw new IllegalArgumentException("FORWARD_INVALID_DELIVERY");
        var message=delivery.messages().getFirst();JSONObject event=new JSONObject();event.putAll(message);
        event.put("type","GROUP_CHAT_EVENT");event.put("event",Boolean.TRUE.equals(message.get("recalled"))?"MESSAGE_RECALLED":"MESSAGE_CREATED");
        event.put("sessionId",Long.toString(delivery.sessionId()));event.put("enterpriseId",Long.toString(delivery.enterpriseId()));
        events.publishForwardMembers(delivery.enterpriseId(),delivery.userRecipientIds(),event);
    }
}
