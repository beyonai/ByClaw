package com.iwhalecloud.byai.state.domain.groupchat.forward.domain;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import java.time.Instant;
import java.util.*;

/** Server-only maintenance extensions are merged into the current checkpoint under owning row locks. */
public final class ForwardMaintenance {
    private ForwardMaintenance() { }
    public enum Category { WORK, DELIVERY }
    public enum Outcome { ENQUEUED, SUPPRESSED }
    public record Candidate(ForwardOperationLocator locator,long targetId,boolean sourcesFrozen) { }
    public record Page(List<Candidate> candidates,String nextCursor) { }
    public record DeliveryLease(ForwardOperationLocator locator,long targetId,String owner,long fencingVersion,
        @com.fasterxml.jackson.annotation.JsonFormat(shape=com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING) Instant leaseUntil,List<String> pendingMessageIds) { }
    public record Delivery(long targetId,long enterpriseId,long sessionId,List<Map<String,Object>> messages,
        List<Long> userRecipientIds) { }
    public static ObjectNode maintenance(ObjectNode checkpoint) {
        var value=checkpoint.get("maintenance");
        if(value==null) { var created=checkpoint.putObject("maintenance");created.put("schemaVersion",1);return created; }
        if(!value.isObject()||value.path("schemaVersion").asInt()!=1)throw new IllegalArgumentException("FORWARD_MAINTENANCE_INVALID");
        return (ObjectNode)value;
    }
    public static List<String> pending(ObjectNode checkpoint,List<String> ids) {
        var entries=maintenance(checkpoint).path("delivery").path("messages");
        if(!entries.isMissingNode()&&!entries.isArray())throw new IllegalArgumentException("FORWARD_MAINTENANCE_INVALID");
        Set<String> done=new HashSet<>();
        for(var entry:entries) {
            if(!ids.contains(entry.path("messageId").asText())||!Set.of("ENQUEUED","SUPPRESSED").contains(entry.path("outcome").asText()))throw new IllegalArgumentException("FORWARD_MAINTENANCE_INVALID");
            done.add(entry.path("messageId").asText());
        }
        return ids.stream().filter(id->!done.contains(id)).toList();
    }
    public static void delivered(ObjectNode checkpoint,String message,String outcome,Instant now) {
        if(!Set.of("ENQUEUED","SUPPRESSED").contains(outcome))throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        var m=maintenance(checkpoint);var d=m.withObject("delivery");var messages=d.withArray("messages");
        for(var entry:messages)if(message.equals(entry.path("messageId").asText()))return;
        messages.addObject().put("messageId",message).put("outcome",outcome).put("completedAt",now.toString());
    }
}
