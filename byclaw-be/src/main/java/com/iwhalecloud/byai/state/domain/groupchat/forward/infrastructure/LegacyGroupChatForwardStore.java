package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatForwardMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.ForwardPlatformPolicy;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.AttachmentCheckpointPatch;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.LegacyForwardSourceAuthorityReader;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.GroupChatForwardStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadReservation;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import org.springframework.stereotype.Component;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.*;
import java.util.*;
import java.util.function.Supplier;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
/** Every callback owns a short transaction; source SQL and inserts share the same Spring-bound connection. */
@Component
public class LegacyGroupChatForwardStore implements GroupChatForwardStore {
    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.beans.factory.ObjectProvider<com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardCommitService> commits;
    @Override public void failTarget(TargetLease lease,String code,boolean retryable) {
        if(!code.matches("RESOURCE_NOT_ACCESSIBLE|FORWARD_[A-Z_]+"))throw denied();
        run(()->{var r=lock(lease.actor().enterpriseId(),lease.requestId());bind(r,lease.actor(),lease.sourceSessionId());var t=lockTarget(r.getEnterpriseId(),lease.targetId());if(!t.getRequestId().equals(r.getRequestId())||t.getTargetSessionId()!=lease.targetSessionId()||rows.failTarget(r.getEnterpriseId(),lease.targetId(),lease.owner(),lease.fencingVersion(),code,retryable)!=1)throw lost();recompute(r);return null;});
    }
    @Override public void failRequest(RequestLease lease,String code,boolean retryable) {
        if(!code.matches("RESOURCE_NOT_ACCESSIBLE|FORWARD_[A-Z_]+"))throw denied();
        run(()->{var r=lock(lease.actor().enterpriseId(),lease.requestId());if(!actor(r).equals(lease.actor())||Boolean.TRUE.equals(r.getSourcesFrozen())||!Objects.equals(r.getLeaseOwner(),lease.owner())||r.getFencingVersion()!=lease.fencingVersion()||!live("byai_group_chat_forward_request","request_id",r.getEnterpriseId(),r.getRequestId()))throw lost();
            var targets=rows.targets(r.getEnterpriseId(),r.getRequestId()).stream().sorted(java.util.Comparator.comparing(ByaiGroupChatForwardTarget::getTargetId)).toList();
            for(var t:targets){lockTarget(r.getEnterpriseId(),t.getTargetId());if("PENDING".equals(t.getState()))db.update("UPDATE byai.byai_group_chat_forward_target SET state='FAILED',error_code=?,retryable=?,fencing_version=fencing_version+1 WHERE enterprise_id=? AND target_id=?",code,retryable,r.getEnterpriseId(),t.getTargetId());}
            db.update("UPDATE byai.byai_group_chat_forward_request SET lease_owner=NULL,lease_until=NULL,fencing_version=fencing_version+1 WHERE enterprise_id=? AND request_id=?",r.getEnterpriseId(),r.getRequestId());recompute(r);return null;});
    }
    @Override public CommitResult commit(TargetLease lease) { return commits.getObject().commit(lease); }
    private final ByaiGroupChatForwardMapper rows;
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final ObjectMapper json;
    private final SequenceService ids;
    private final SessionService sessions;
    private final SessionMemberService members;
    private final LegacyForwardSourceAuthorityReader sources;
    private final ForwardPlatformPolicy policy;
    private final ForwardManifest manifests;
    public LegacyGroupChatForwardStore(ByaiGroupChatForwardMapper rows,JdbcTemplate db,PlatformTransactionManager manager,ObjectMapper json,SequenceService ids,SessionService sessions,SessionMemberService members,LegacyForwardSourceAuthorityReader sources,ForwardPlatformPolicy policy,ForwardUploadReservation locations,GroupChatForwardProperties properties) {
        this.rows=rows;
        this.db=db;
        this.tx=new TransactionTemplate(manager);
        this.json=json;
        this.ids=ids;
        this.sessions=sessions;
        this.members=members;
        this.sources=sources;
        this.policy=policy;
        this.manifests=new ForwardManifest(json,locations,properties.effectiveMaxFileBytes());
    }
    private <T>T run(Supplier<T> work) {
        return tx.execute(status->work.get());
    }
    private static IllegalArgumentException denied() {
        return new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
    }
    private static IllegalArgumentException lost() {
        return new IllegalArgumentException("FORWARD_LEASE_LOST");
    }
    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        }
        catch(Exception e) {
            throw new IllegalArgumentException("FORWARD_ENCODING_FAILED",e);
        }
    }
    private <T>T read(String value,Class<T> type) {
        try {
            return json.readValue(value,type);
        }
        catch(Exception e) {
            throw new IllegalArgumentException("FORWARD_ENCODING_FAILED",e);
        }
    }
    private ByaiGroupChatForwardRequest lock(long tenant,long id) {
        db.queryForList("SELECT request_id FROM byai.byai_group_chat_forward_request WHERE enterprise_id=? AND request_id=? FOR UPDATE",tenant,id);
        var r=rows.request(tenant,id);
        if(r==null||!"LEGACY".equals(r.getBackend()))throw denied();
        return r;
    }
    private ByaiGroupChatForwardTarget lockTarget(long tenant,long id) {
        db.queryForList("SELECT target_id FROM byai.byai_group_chat_forward_target WHERE enterprise_id=? AND target_id=? FOR UPDATE",tenant,id);
        var t=rows.target(tenant,id);
        if(t==null)throw denied();
        return t;
    }
    private static ForwardActor actor(ByaiGroupChatForwardRequest r) {
        return new ForwardActor(r.getActorUserId(),r.getEnterpriseId());
    }
    private static OperationBinding binding(ByaiGroupChatForwardRequest r) {
        return new OperationBinding(new ForwardOperationLocator(r.getEnterpriseId(),r.getRequestId(),ForwardBackend.LEGACY),actor(r),r.getSourceSessionId());
    }
    private static void bind(ByaiGroupChatForwardRequest r,ForwardActor actor,long source) {
        if(!actor(r).equals(actor)||r.getSourceSessionId()!=source)throw denied();
    }
    private Set<Long> eligible(ByaiGroupChatForwardRequest r,Collection<Long> targets,boolean partial) {
        var actor=actor(r);
        policy.requireNewWork(actor,ForwardBackend.LEGACY);
        var groups=new TreeSet<Long>(targets);
        groups.add(r.getSourceSessionId());
        // These are real row locks. The historical SessionService.lockById SQL did not actually lock.
        for(long id:groups) {
            db.queryForList("SELECT session_id FROM byai.byai_session WHERE session_id=? FOR UPDATE",id);
            db.queryForList("SELECT byai_session_member_id FROM byai.byai_session_member WHERE session_id=? AND mem_obj_type='USER' AND mem_obj_id=? FOR UPDATE",id,actor.userId());
        }
        var source=identity(r.getSourceSessionId());
        ForwardEligibility.requireSource(actor,source,members.findSessionMember(r.getSourceSessionId(),"USER",actor.userId())!=null);
        Set<Long> allowed=new HashSet<>();
        for(long id:targets) {
            try {
                ForwardEligibility.requireTarget(actor,source,identity(id),members.findSessionMember(id,"USER",actor.userId())!=null);
                allowed.add(id);
            }
            catch(IllegalArgumentException error) {
                if(!partial||!"RESOURCE_NOT_ACCESSIBLE".equals(error.getMessage()))throw error;
            }
        }
        return allowed;
    }
    private ForwardEligibility.GroupIdentity identity(long id) {
        var s=sessions.findById(id);
        return s==null?null:new ForwardEligibility.GroupIdentity(id,s.getEnterpriseId(),s.getSessionType(),s.getState());
    }
    private ForwardOperation operation(ByaiGroupChatForwardRequest r) {
        return new ForwardOperation(r.getRequestId(),ForwardOperationState.valueOf(r.getState()),rows.targets(r.getEnterpriseId(),r.getRequestId()).stream().map(t->new ForwardTarget(t.getTargetSessionId(),ForwardState.valueOf(t.getState()),Arrays.asList(read(t.getMessageIdsJson(),String[].class)),t.getErrorCode(),Boolean.TRUE.equals(t.getRetryable()))).toList());
    }
    /** The caller holds request lock before touching a branch, including final publication's later consumer. */
    public void recompute(ByaiGroupChatForwardRequest r) {
        var targets=rows.targets(r.getEnterpriseId(),r.getRequestId());
        String state=targets.stream().anyMatch(t->Set.of("PENDING","COPYING","READY").contains(t.getState()))?"RUNNING":targets.stream().allMatch(t->"SUCCEEDED".equals(t.getState()))?"SUCCEEDED":targets.stream().anyMatch(t->"SUCCEEDED".equals(t.getState()))?"PARTIAL_FAILED":"FAILED";
        rows.updateRequestState(r.getEnterpriseId(),r.getRequestId(),state);
        r.setState(state);
    }
    @Override public ForwardOperation prepare(ForwardActor actor,long source,ForwardInput input) {
        return run(()-> {
            String hash=new ForwardCodec().canonicalHash(actor,source,input);var old=rows.requestByKey(actor.enterpriseId(),actor.userId(),input.clientRequestId()); if(old!=null)return replay(old,actor,source,hash); long requestId=ids.nextVal();int won=db.update("INSERT INTO byai.byai_group_chat_forward_request(request_id,enterprise_id,actor_user_id,backend,source_session_id,client_request_id,mode,request_hash,snapshot_version,frozen_json,source_manifest_json) VALUES(?,?,?,'LEGACY',?,?,?,?,1,'{}','{}') ON CONFLICT DO NOTHING",requestId,actor.enterpriseId(),actor.userId(),source,input.clientRequestId(),input.mode().name(),hash); if(won==0)return replay(rows.requestByKey(actor.enterpriseId(),actor.userId(),input.clientRequestId()),actor,source,hash); var request=lock(actor.enterpriseId(),requestId);var valid=eligible(request,input.targetSessionIds(),true); String placeholders=String.join(",",Collections.nCopies(input.messageIds().size(),"?"));List<Object> parameters=new ArrayList<>(List.of(actor.enterpriseId(),source));parameters.addAll(input.messageIds()); var ordered=db.queryForList("SELECT message_id FROM byai.byai_message WHERE enterprise_id=? AND session_id=? AND message_id IN ("+placeholders+") ORDER BY create_time ASC,message_id ASC FOR UPDATE",Long.class,parameters.toArray()); if(ordered.size()!=input.messageIds().size())throw denied();List<ForwardSnapshotFactory.SourceMessage> selected=new ArrayList<>();for(long id:ordered) {
                var m=sources.readMessage(actor,ForwardBackend.LEGACY,source,id);selected.add(new ForwardSnapshotFactory.SourceMessage(m.id(),selected.size(),m.content(),m.speaker(),m.createdAt(),m.resourceList(),m.relatedResources(),m.metadata(),m.mergedItems(),m.authority()));
            }
            var frozen=new ForwardSnapshotFactory().freeze(actor,source,selected);List<PreparedCandidate> candidates=new ArrayList<>();for(var c:frozen.candidates()) {
                if(c.address()==null)throw denied();candidates.add(new PreparedCandidate("c"+candidates.size(),c.itemKey(),c.selectedMessageId(),c.kind(),c.address()));
            }
            List<PreparedSlot> slots=new ArrayList<>();for(long group:input.targetSessionIds()) {
                long targetId=ids.nextVal();var target=new ByaiGroupChatForwardTarget();target.setTargetId(targetId);target.setEnterpriseId(actor.enterpriseId());target.setRequestId(requestId);target.setTargetSessionId(group);rows.insertTarget(target); if(!valid.contains(group)) {
                    db.update("UPDATE byai.byai_group_chat_forward_target SET state='FAILED',error_code='RESOURCE_NOT_ACCESSIBLE',retryable=FALSE WHERE target_id=? AND enterprise_id=?",targetId,actor.enterpriseId());continue;
                }
                for(var template:frozen.items()) {
                    long itemId=ids.nextVal();var item=new ByaiGroupChatForwardItem();item.setItemId(itemId);item.setEnterpriseId(actor.enterpriseId());item.setRequestId(requestId);item.setTargetId(targetId);item.setOrdinal(template.ordinal());item.setSelectedMessageId(template.selectedMessageId());item.setSelectedMergedCard(template.selectedMergedCard());item.setSourceMessageId(template.sourceMessageId());item.setContent(template.content());item.setSpeakerJson(write(template.speaker()));item.setSourceCreatedAt(Instant.parse(template.createdAt()));item.setReferencesJson(write(template.resourceList()));item.setAttachmentsJson("[]");rows.insertItem(item);for(var c:candidates)if(c.itemKey().equals(template.sourceKey()))slots.add(new PreparedSlot(c.candidateId(),Long.toString(targetId),Long.toString(itemId),ids.nextVal().toString()));
                }
            }
            db.update("UPDATE byai.byai_group_chat_forward_request SET frozen_json=?,source_manifest_json=? WHERE enterprise_id=? AND request_id=?",write(new PreparedSnapshot(frozen.selectedMessageIds(),frozen.items(),frozen.snapshotVersion())),write(new SourceManifest(1,candidates,slots,List.of(),List.of(),List.of())),actor.enterpriseId(),requestId);recompute(request);return operation(request);
        }
        );
    }
    private ForwardOperation replay(ByaiGroupChatForwardRequest r,ForwardActor actor,long source,String hash) {
        if(r==null)throw denied();
        if(!hash.equals(r.getRequestHash())||!"LEGACY".equals(r.getBackend()))throw new IllegalArgumentException("IDEMPOTENCY_CONFLICT");
        bind(r,actor,source);
        return operation(r);
    }
    @Override public WorkPage discoverWork(long enterprise,String after,int limit) {
        if(enterprise<=0||limit<=0||limit>20)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        long cursor=after==null?0:ForwardCodec.parseId(after);
        return run(()-> {
            var found=db.query("SELECT t.target_id,t.request_id,r.sources_frozen FROM byai.byai_group_chat_forward_target t JOIN byai.byai_group_chat_forward_request r ON r.enterprise_id=t.enterprise_id AND r.request_id=t.request_id WHERE t.enterprise_id=? AND r.backend='LEGACY' AND r.state='RUNNING' AND t.target_id>? AND t.state IN ('PENDING','COPYING','READY') AND (t.lease_until IS NULL OR t.lease_until<=clock_timestamp()) AND (r.sources_frozen=TRUE OR r.lease_until IS NULL OR r.lease_until<=clock_timestamp()) AND NOT EXISTS(SELECT 1 FROM byai.byai_group_chat_forward_target live WHERE live.enterprise_id=t.enterprise_id AND live.request_id=t.request_id AND live.state IN ('COPYING','READY') AND live.lease_until>clock_timestamp()) ORDER BY t.target_id LIMIT ?",(rs,index)->new WorkCandidate(new ForwardOperationLocator(enterprise,rs.getLong("request_id"),ForwardBackend.LEGACY),rs.getLong("target_id"),rs.getBoolean("sources_frozen")),enterprise,cursor,limit+1);boolean more=found.size()>limit;var page=found.stream().limit(limit).toList();return new WorkPage(page,more?Long.toString(page.getLast().targetId()):null,more);
        }
        );
    }
    @Override public TargetIdentity inspectTarget(ForwardOperationLocator locator,long target) {
        if(locator.backend()!=ForwardBackend.LEGACY)throw denied();
        return run(()-> {
            var request=lock(locator.enterpriseId(),locator.requestId());var row=rows.target(locator.enterpriseId(),target);if(row==null||!row.getRequestId().equals(request.getRequestId()))throw denied();return new TargetIdentity(target,row.getTargetSessionId(),ForwardState.valueOf(row.getState()));
        }
        );
    }
    @Override public OperationBinding inspect(ForwardOperationLocator locator) {
        if(locator.backend()!=ForwardBackend.LEGACY)throw denied();
        return run(()->binding(lock(locator.enterpriseId(),locator.requestId())));
    }
    private static void owner(String owner,Duration duration) {
        if(owner==null||!owner.matches("[A-Za-z0-9:_-]{1,128}")||duration==null||duration.toMillis()<=0)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
    }
    private static RequestLease requestLease(ByaiGroupChatForwardRequest r) {
        return new RequestLease(r.getRequestId(),actor(r),r.getLeaseOwner(),r.getFencingVersion(),r.getLeaseUntil());
    }
    private static TargetLease targetLease(ByaiGroupChatForwardRequest r,ByaiGroupChatForwardTarget t) {
        return new TargetLease(r.getRequestId(),t.getTargetId(),actor(r),r.getSourceSessionId(),t.getTargetSessionId(),t.getLeaseOwner(),t.getFencingVersion(),t.getLeaseUntil(),ForwardState.valueOf(t.getState()));
    }
    private boolean live(String table,String column,long tenant,long id) {
        return !db.queryForList("SELECT 1 FROM byai."+table+" WHERE enterprise_id=? AND "+column+"=? AND lease_until>clock_timestamp()",tenant,id).isEmpty();
    }
    @Override public RequestLease claimRequest(ForwardOperationLocator locator,String owner,Duration duration) {
        owner(owner,duration);
        if(locator.backend()!=ForwardBackend.LEGACY)throw denied();
        return run(()-> {
            var r=lock(locator.enterpriseId(),locator.requestId());eligible(r,List.of(),false);if(rows.claimRequest(locator.enterpriseId(),locator.requestId(),owner,duration.toMillis())!=1)throw lost();return requestLease(rows.request(locator.enterpriseId(),locator.requestId()));
        }
        );
    }
    @Override public TargetLease claimTarget(ForwardOperationLocator locator,long targetId,String owner,Duration duration) {
        owner(owner,duration);
        if(locator.backend()!=ForwardBackend.LEGACY)throw denied();
        return run(()-> {
            var r=lock(locator.enterpriseId(),locator.requestId());var target=rows.target(locator.enterpriseId(),targetId);if(target==null||!target.getRequestId().equals(r.getRequestId())||!Boolean.TRUE.equals(r.getSourcesFrozen())||!"RUNNING".equals(r.getState()))throw lost();eligible(r,List.of(target.getTargetSessionId()),false);lockTarget(locator.enterpriseId(),targetId); if(!db.queryForList("SELECT 1 FROM byai.byai_group_chat_forward_target WHERE enterprise_id=? AND request_id=? AND target_id<>? AND state IN ('COPYING','READY') AND lease_until>clock_timestamp()",locator.enterpriseId(),locator.requestId(),targetId).isEmpty()||rows.claimTarget(locator.enterpriseId(),targetId,owner,duration.toMillis())!=1)throw lost();return targetLease(r,rows.target(locator.enterpriseId(),targetId));
        }
        );
    }
    private ByaiGroupChatForwardRequest checked(RequestLease lease) {
        var r=lock(lease.actor().enterpriseId(),lease.requestId());
        if(!actor(r).equals(lease.actor())||!Objects.equals(r.getLeaseOwner(),lease.owner())||r.getFencingVersion()!=lease.fencingVersion()||!"RUNNING".equals(r.getState())||Boolean.TRUE.equals(r.getSourcesFrozen())||!live("byai_group_chat_forward_request","request_id",r.getEnterpriseId(),r.getRequestId()))throw lost();
        eligible(r,List.of(),false);
        return r;
    }
    private record Bound(ByaiGroupChatForwardRequest request,ByaiGroupChatForwardTarget target) {
    }
    private Bound checked(TargetLease lease) {
        var r=lock(lease.actor().enterpriseId(),lease.requestId());
        bind(r,lease.actor(),lease.sourceSessionId());
        eligible(r,List.of(lease.targetSessionId()),false);
        var t=lockTarget(r.getEnterpriseId(),lease.targetId());
        if(!t.getRequestId().equals(r.getRequestId())||t.getTargetSessionId()!=lease.targetSessionId()||!Objects.equals(t.getLeaseOwner(),lease.owner())||t.getFencingVersion()!=lease.fencingVersion()||!t.getState().equals(lease.state().name())||!Boolean.TRUE.equals(r.getSourcesFrozen())||!"RUNNING".equals(r.getState())||!live("byai_group_chat_forward_target","target_id",r.getEnterpriseId(),t.getTargetId()))throw lost();
        return new Bound(r,t);
    }
    @Override public RequestLease renewRequest(RequestLease lease,Duration duration) {
        return run(()-> {
            checked(lease);owner(lease.owner(),duration);if(rows.renewRequest(lease,duration.toMillis())!=1)throw lost();return requestLease(rows.request(lease.actor().enterpriseId(),lease.requestId()));
        }
        );
    }
    @Override public TargetLease renewTarget(TargetLease lease,Duration duration) {
        return run(()-> {
            var b=checked(lease);owner(lease.owner(),duration);if(rows.renewTarget(lease,duration.toMillis())!=1)throw lost();return targetLease(b.request(),rows.target(lease.actor().enterpriseId(),lease.targetId()));
        }
        );
    }
    @Override public void freezeSources(RequestLease lease,FreezeCompletion completion) {
        run(()-> {
            var r=checked(lease);Set<String> valid=new HashSet<>();for(var t:rows.targets(r.getEnterpriseId(),r.getRequestId()))if(!"FAILED".equals(t.getState()))valid.add(t.getTargetId().toString());var manifest=manifests.complete(read(r.getSourceManifestJson(),SourceManifest.class),completion,actor(r),valid);if(rows.freezeSources(r.getEnterpriseId(),r.getRequestId(),lease.owner(),lease.fencingVersion(),write(manifest))!=1)throw lost();return null;
        }
        );
    }
    @Override public TargetLease checkpointAttachment(TargetLease lease,long expectedVersion,AttachmentCheckpointPatch patch) {
        return run(()-> {
            if(expectedVersion!=lease.fencingVersion())throw lost();var b=checked(lease);var manifest=read(b.request().getSourceManifestJson(),SourceManifest.class);manifests.budgets(manifest);var next=manifests.patch(read(b.target().getCheckpointJson(),ObjectNode.class),manifest,lease,patch);if(rows.checkpoint(lease.actor().enterpriseId(),lease.targetId(),lease.owner(),lease.fencingVersion(),write(next),"COPYING")!=1)throw lost();return targetLease(b.request(),rows.target(lease.actor().enterpriseId(),lease.targetId()));
        }
        );
    }
    @Override public TargetLease markReady(TargetLease lease) {
        return run(()-> {
            var b=checked(lease);if(lease.state()!=ForwardState.COPYING&&lease.state()!=ForwardState.READY)throw lost();var manifest=read(b.request().getSourceManifestJson(),SourceManifest.class);var checkpoint=read(b.target().getCheckpointJson(),ObjectNode.class);manifests.ready(checkpoint,manifest,lease);checkpoint.put("progress",100);if(!checkpoint.has("copiedObjects"))checkpoint.putArray("copiedObjects");if(!checkpoint.has("attachmentMapping"))checkpoint.putObject("attachmentMapping");if(rows.checkpoint(lease.actor().enterpriseId(),lease.targetId(),lease.owner(),lease.fencingVersion(),write(checkpoint),"READY")!=1)throw lost();return targetLease(b.request(),rows.target(lease.actor().enterpriseId(),lease.targetId()));
        }
        );
    }
    private ForwardWork work(ByaiGroupChatForwardRequest r,ByaiGroupChatForwardTarget t) {
        return new ForwardWork(binding(r).locator(),actor(r),r.getSourceSessionId(),read(r.getFrozenJson(),PreparedSnapshot.class),read(r.getSourceManifestJson(),SourceManifest.class),Boolean.TRUE.equals(r.getSourcesFrozen()),t==null?null:new TargetWork(t.getTargetId(),t.getTargetSessionId(),ForwardState.valueOf(t.getState()),read(t.getCheckpointJson(),ObjectNode.class),rows.items(r.getEnterpriseId(),t.getTargetId()).stream().map(i->new ForwardItem(i.getItemId().toString(),i.getSelectedMessageId(),i.getSelectedMergedCard(),i.getSourceMessageId(),i.getOrdinal(),i.getContent(),read(i.getSpeakerJson(),ForwardSpeaker.class),i.getSourceCreatedAt().toString(),Arrays.asList(read(i.getReferencesJson(),ForwardReference[].class)),Arrays.asList(read(i.getAttachmentsJson(),ForwardAttachment[].class)))).toList()));
    }
    @Override public ForwardWork requestWork(RequestLease lease) {
        return run(()->work(checked(lease),null));
    }
    @Override public ForwardWork targetWork(TargetLease lease) {
        return run(()-> {
            var b=checked(lease);return work(b.request(),b.target());
        }
        );
    }
    private ForwardSnapshotFactory.SourceMessage source(ByaiGroupChatForwardRequest r,long id) {
        if(!read(r.getFrozenJson(),PreparedSnapshot.class).selectedMessageIds().contains(id))throw denied();
        return sources.readMessage(actor(r),ForwardBackend.LEGACY,r.getSourceSessionId(),id);
    }
    @Override public ForwardSnapshotFactory.SourceMessage source(RequestLease lease,long selected) {
        return run(()->source(checked(lease),selected));
    }
    @Override public ForwardSnapshotFactory.SourceMessage source(TargetLease lease,long selected) {
        return run(()->source(checked(lease).request(),selected));
    }
    @Override public ForwardOperation status(ForwardActor actor,long source,long request) {
        return run(()-> {
            var r=lock(actor.enterpriseId(),request);bind(r,actor,source);return operation(r);
        }
        );
    }
    @Override public ForwardOperation retry(ForwardActor actor,long source,long request,Set<Long> groups) {
        return run(()-> {
            var r=lock(actor.enterpriseId(),request);bind(r,actor,source);var targets=rows.targets(actor.enterpriseId(),request);if(groups.size()>10||groups.stream().anyMatch(g->g==null||g<=0||targets.stream().noneMatch(t->t.getTargetSessionId().equals(g))))throw denied();var selected=targets.stream().filter(t->groups.contains(t.getTargetSessionId())&&!"SUCCEEDED".equals(t.getState())&&(!"FAILED".equals(t.getState())||Boolean.TRUE.equals(t.getRetryable()))&&!live("byai_group_chat_forward_target","target_id",actor.enterpriseId(),t.getTargetId())).sorted(Comparator.comparing(ByaiGroupChatForwardTarget::getTargetId)).toList();if(!selected.isEmpty()) {
                eligible(r,selected.stream().map(ByaiGroupChatForwardTarget::getTargetSessionId).toList(),false);for(var target:selected) {
                    lockTarget(actor.enterpriseId(),target.getTargetId());if("FAILED".equals(target.getState()))rows.resetFailedTarget(actor.enterpriseId(),target.getTargetId());else db.update("UPDATE byai.byai_group_chat_forward_target SET state=CASE WHEN state='READY' THEN 'READY' ELSE 'PENDING' END,lease_owner=NULL,lease_until=NULL,fencing_version=fencing_version+1 WHERE enterprise_id=? AND target_id=? AND (lease_until IS NULL OR lease_until<=clock_timestamp())",actor.enterpriseId(),target.getTargetId());
                }
                recompute(r);
            }
            return operation(r);
        }
        );
    }
}
