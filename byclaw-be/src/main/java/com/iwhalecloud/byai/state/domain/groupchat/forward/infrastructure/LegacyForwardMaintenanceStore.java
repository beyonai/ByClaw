package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatForwardMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.*;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.session.service.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardMaintenanceStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.*;
import java.util.*;
import java.util.function.Supplier;

/** Short request-first transactions provide service authority independently of the original actor's membership. */
@Component
public class LegacyForwardMaintenanceStore implements ForwardMaintenanceStore {
    private final JdbcTemplate db; private final ByaiGroupChatForwardMapper rows; private final ObjectMapper json;
    private final TransactionTemplate tx;private final SessionService sessions;private final SessionMemberService members;
    private final ByaiMessageMapper messages;private final GroupChatContextService projection;private final LegacyGroupChatForwardStore store;
    public LegacyForwardMaintenanceStore(JdbcTemplate db,ByaiGroupChatForwardMapper rows,ObjectMapper json,
        PlatformTransactionManager manager,SessionService sessions,SessionMemberService members,
        ByaiMessageMapper messages,GroupChatContextService projection,LegacyGroupChatForwardStore store) {
        this.db=db;this.rows=rows;this.json=json;this.tx=new TransactionTemplate(manager);this.sessions=sessions;
        this.members=members;this.messages=messages;this.projection=projection;this.store=store;
    }
    private <T>T run(Supplier<T> work){return tx.execute(status->work.get());}
    private static IllegalArgumentException lost(){return new IllegalArgumentException("FORWARD_LEASE_LOST");}
    private static IllegalArgumentException denied(){return new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");}
    private ObjectNode read(String value){try{return (ObjectNode)json.readTree(value);}catch(Exception e){throw new IllegalArgumentException("FORWARD_MAINTENANCE_INVALID");}}
    private String write(Object value){try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalArgumentException("FORWARD_MAINTENANCE_INVALID");}}
    private List<String> ids(ByaiGroupChatForwardTarget t){try{return Arrays.asList(json.readValue(t.getMessageIdsJson(),String[].class));}catch(Exception e){throw denied();}}
    private record Locked(ByaiGroupChatForwardRequest request,ByaiGroupChatForwardTarget target,Instant now,ObjectNode checkpoint) { }
    private Locked bound(ForwardOperationLocator l,long target){
        if(l.backend()!=ForwardBackend.LEGACY)throw denied();
        db.queryForList("SELECT request_id FROM byai.byai_group_chat_forward_request WHERE enterprise_id=? AND request_id=? FOR UPDATE",l.enterpriseId(),l.requestId());
        var r=rows.request(l.enterpriseId(),l.requestId());
        db.queryForList("SELECT target_id FROM byai.byai_group_chat_forward_target WHERE enterprise_id=? AND target_id=? FOR UPDATE",l.enterpriseId(),target);
        var t=rows.target(l.enterpriseId(),target);
        if(r==null||!"LEGACY".equals(r.getBackend())||t==null||t.getRequestId()!=l.requestId())throw denied();
        Instant now=db.queryForObject("SELECT clock_timestamp()",java.sql.Timestamp.class).toInstant();
        return new Locked(r,t,now,read(t.getCheckpointJson()));
    }
    private static boolean live(Instant deadline,Instant now){return deadline!=null&&deadline.isAfter(now);}
    private static void duration(String owner,Duration duration){if(owner==null||!owner.matches("[A-Za-z0-9:_-]{1,128}")||duration.toMillis()<1||duration.toMillis()>300000)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");}
    @Override public Page scan(long enterprise,Category category,String after,int limit){
        if(enterprise<=0||limit<1||limit>20)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");long cursor=after==null?0:com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec.parseId(after);
        String predicate=switch(category){case WORK->"t.state IN ('PENDING','COPYING','READY') AND (t.lease_until IS NULL OR t.lease_until<=clock_timestamp())";case DELIVERY->"t.state='SUCCEEDED' AND t.pending_delivery=TRUE AND (t.lease_until IS NULL OR t.lease_until<=clock_timestamp())";};
        return run(()->{var candidates=db.query("SELECT t.target_id,r.request_id,r.sources_frozen FROM byai.byai_group_chat_forward_target t JOIN byai.byai_group_chat_forward_request r ON t.request_id=r.request_id AND t.enterprise_id=r.enterprise_id WHERE t.enterprise_id=? AND r.backend='LEGACY' AND t.target_id>? AND "+predicate+" ORDER BY t.target_id LIMIT ?",(rs,n)->new Candidate(new ForwardOperationLocator(enterprise,rs.getLong("request_id"),ForwardBackend.LEGACY),rs.getLong("target_id"),rs.getBoolean("sources_frozen")),enterprise,cursor,limit);return new Page(candidates,candidates.size()==limit?Long.toString(candidates.getLast().targetId()):null);});
    }
    private DeliveryLease ticket(ForwardOperationLocator l,ByaiGroupChatForwardTarget t,ObjectNode c){return new DeliveryLease(l,t.getTargetId(),t.getLeaseOwner(),t.getFencingVersion(),t.getLeaseUntil(),ForwardMaintenance.pending(c,ids(t)));}
    private void deliveryOwned(Locked b,DeliveryLease l){var t=b.target();if(!"SUCCEEDED".equals(t.getState())||!Boolean.TRUE.equals(t.getPendingDelivery())||!Objects.equals(t.getLeaseOwner(),l.owner())||t.getFencingVersion()!=l.fencingVersion()||!live(t.getLeaseUntil(),b.now()))throw lost();}
    @Override public DeliveryLease claimDelivery(ForwardOperationLocator l,long target,String owner,Duration duration){duration(owner,duration);return run(()->{var b=bound(l,target);var t=b.target();if(!"SUCCEEDED".equals(t.getState())||!Boolean.TRUE.equals(t.getPendingDelivery())||live(t.getLeaseUntil(),b.now()))return null;
        var until=b.now().plus(duration);var d=ForwardMaintenance.maintenance(b.checkpoint()).withObject("delivery");d.put("owner",owner).put("leaseUntil",until.toString());
        db.update("UPDATE byai.byai_group_chat_forward_target SET lease_owner=?,lease_until=?,fencing_version=fencing_version+1,checkpoint_json=? WHERE enterprise_id=? AND target_id=?",owner,java.sql.Timestamp.from(until),write(b.checkpoint()),l.enterpriseId(),target);
        t.setLeaseOwner(owner);t.setLeaseUntil(until);t.setFencingVersion(t.getFencingVersion()+1);return ticket(l,t,b.checkpoint());});}
    @Override public DeliveryLease renewDelivery(DeliveryLease l,Duration duration){duration(l.owner(),duration);return run(()->{var b=bound(l.locator(),l.targetId());deliveryOwned(b,l);var until=b.now().plus(duration);if(until.isBefore(b.target().getLeaseUntil()))until=b.target().getLeaseUntil();ForwardMaintenance.maintenance(b.checkpoint()).withObject("delivery").put("leaseUntil",until.toString());db.update("UPDATE byai.byai_group_chat_forward_target SET lease_until=?,checkpoint_json=? WHERE enterprise_id=? AND target_id=?",java.sql.Timestamp.from(until),write(b.checkpoint()),l.locator().enterpriseId(),l.targetId());b.target().setLeaseUntil(until);return ticket(l.locator(),b.target(),b.checkpoint());});}
    @Override public Delivery delivery(DeliveryLease l,long messageId){return run(()->{var b=bound(l.locator(),l.targetId());deliveryOwned(b,l);var t=b.target();if(!ForwardMaintenance.pending(b.checkpoint(),ids(t)).contains(Long.toString(messageId)))throw denied();
        if(rows.items(t.getEnterpriseId(),t.getTargetId()).stream().noneMatch(i->Objects.equals(i.getBoundMessageId(),messageId)))throw denied();
        var s=sessions.findById(t.getTargetSessionId());if(s==null||!Objects.equals(s.getEnterpriseId(),t.getEnterpriseId())||!"hs_as".equals(s.getSessionType())||Set.of("CLOSED","GROUP_DISSOLVED","GROUP_CHAT_ROUTING","GROUP_CHAT_DISPATCH").contains(Objects.toString(s.getState(),"")))return null;
        var m=messages.selectByMessageId(messageId);if(m==null||!Objects.equals(m.getEnterpriseId(),t.getEnterpriseId())||!Objects.equals(m.getSessionId(),t.getTargetSessionId())||m.getArchivedAt()!=null||!Set.of(1,2).contains(m.getUsage()))return null;
        List<Map<String,Object>> displayed=json.convertValue(projection.toMessages(List.of(m)),new com.fasterxml.jackson.core.type.TypeReference<>(){});
        var recipients=members.findSessionMembers(t.getTargetSessionId(),"USER",null).stream().map(v->v.getMemObjId()).distinct().toList();
        return new Delivery(t.getTargetId(),t.getEnterpriseId(),t.getTargetSessionId(),displayed,recipients);});}
    @Override public DeliveryLease markDelivered(DeliveryLease l,long messageId,Outcome outcome){return run(()->{var b=bound(l.locator(),l.targetId());deliveryOwned(b,l);var t=b.target();if(!ids(t).contains(Long.toString(messageId)))throw denied();ForwardMaintenance.delivered(b.checkpoint(),Long.toString(messageId),outcome.name(),b.now());boolean pending=!ForwardMaintenance.pending(b.checkpoint(),ids(t)).isEmpty();if(!pending){var d=ForwardMaintenance.maintenance(b.checkpoint()).withObject("delivery");d.putNull("owner").putNull("leaseUntil");}
        db.update("UPDATE byai.byai_group_chat_forward_target SET checkpoint_json=?,pending_delivery=?,fencing_version=fencing_version+1,lease_owner=?,lease_until=? WHERE enterprise_id=? AND target_id=?",write(b.checkpoint()),pending,pending?t.getLeaseOwner():null,pending?java.sql.Timestamp.from(t.getLeaseUntil()):null,t.getEnterpriseId(),t.getTargetId());t.setFencingVersion(t.getFencingVersion()+1);return ticket(l.locator(),t,b.checkpoint());});}
    @Override public void failTarget(TargetLease lease,String code,boolean retryable){if(!code.matches("RESOURCE_NOT_ACCESSIBLE|FORWARD_[A-Z_]+"))throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");run(()->{var b=bound(new ForwardOperationLocator(lease.actor().enterpriseId(),lease.requestId(),ForwardBackend.LEGACY),lease.targetId());if(b.request().getActorUserId()!=lease.actor().userId()||b.request().getSourceSessionId()!=lease.sourceSessionId()||b.target().getTargetSessionId()!=lease.targetSessionId())throw denied();if(rows.failTarget(lease.actor().enterpriseId(),lease.targetId(),lease.owner(),lease.fencingVersion(),code,retryable)!=1)throw lost();store.recompute(b.request());return null;});}
}
