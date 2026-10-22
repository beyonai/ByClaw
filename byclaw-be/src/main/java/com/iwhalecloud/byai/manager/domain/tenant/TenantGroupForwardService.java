package com.iwhalecloud.byai.manager.domain.tenant;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.ForwardPlatformPolicy;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.ForwardSourceProjection;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.GroupChatForwardStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.AttachmentCheckpointPatch;
import org.springframework.stereotype.Service;
import java.time.Duration;
import java.util.*;
/** Typed operation transport; persisted identities are discovered under service auth before phase eligibility checks. */
@Service
public class TenantGroupForwardService implements GroupChatForwardStore {
    private final TenantNodeClient node;
    private final ForwardPlatformPolicy policy;
    private final com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties properties;
    public TenantGroupForwardService(TenantNodeClient node,ForwardPlatformPolicy policy,com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties properties) {
        this.node=node;
        this.policy=policy;
        this.properties=properties;
    }
    private String path(long source,long request) {
        return "/internal/v1/group-chats/"+source+"/forward-requests/"+request;
    }
    private String path(TargetLease lease) {
        return path(lease.sourceSessionId(),lease.requestId())+"/targets/"+lease.targetId();
    }
    private <I,O>O call(ForwardActor actor,String method,String path,I body,TypeReference<O> result) {
        return forwarding(() -> node.request(policy.requireNewWork(actor,ForwardBackend.TENANT),method,path,body,result));
    }
    /** Only known status/code pairs are domain rejections; transport failures must remain visible. */
    private <O> O forwarding(java.util.function.Supplier<O> request) {
        try {
            return request.get();
        } catch (TenantNodeClient.NodeRejection error) {
            if (error.nodeStatus() == 409 && "FORWARD_LEASE_LOST".equals(error.code())
                || (error.nodeStatus() == 403 || error.nodeStatus() == 404)
                    && "RESOURCE_NOT_ACCESSIBLE".equals(error.code())) {
                throw new IllegalArgumentException(error.code(), error);
            }
            throw error;
        }
    }
    public com.iwhalecloud.byai.common.page.PageInfo<com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos.TargetItem> targets(ForwardActor actor,long source,int page,int size,String keyword) {
        String query="?pageNum="+page+"&pageSize="+size+(keyword==null?"":"&keyword="+java.net.URLEncoder.encode(keyword,java.nio.charset.StandardCharsets.UTF_8));
        return call(actor,"GET","/internal/v1/group-chats/"+source+"/forward-targets"+query,null,new TypeReference<>() { });
    }
    public com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos.ItemPage items(ForwardActor actor,long group,long message,int size,String cursor) {
        String query="?pageSize="+size+(cursor==null?"":"&cursor="+java.net.URLEncoder.encode(cursor,java.nio.charset.StandardCharsets.UTF_8));
        return call(actor,"GET","/internal/v1/group-chats/"+group+"/messages/"+message+"/forward-items"+query,null,new TypeReference<>() { });
    }
    /** Physical metadata is service-only and must be checked against the request binding before local archive opening. */

    @Override public WorkPage discoverWork(long enterprise,String after,int limit) {
        if(limit<=0||limit>20)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        if(after!=null)com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec.parseId(after);
        return node.serviceRequest(enterprise,"GET","/internal/v1/forward-work?limit="+limit+(after==null?"":"&afterTargetId="+after),null,new TypeReference<WorkPage>() {
        }
        );
    }
    @Override public WorkPage discoverRequestWork(ForwardOperationLocator locator) {
        if(locator.backend()!=ForwardBackend.TENANT)throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        return forwarding(() -> node.serviceRequest(locator.enterpriseId(),"GET","/internal/v1/forward-work?limit=20&requestId="+locator.requestId(),null,new TypeReference<WorkPage>(){}));
    }
    @Override public TargetIdentity inspectTarget(ForwardOperationLocator locator,long target) {
        inspect(locator);
        return forwarding(() -> node.serviceRequest(locator.enterpriseId(),"GET","/internal/v1/forward-work/"+locator.requestId()+"/targets/"+target+"/binding",null,new TypeReference<TargetIdentity>() {
        }
        ));
    }
    @Override public OperationBinding inspect(ForwardOperationLocator locator) {
        if(locator.backend()!=ForwardBackend.TENANT)throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        var result=forwarding(() -> node.serviceRequest(locator.enterpriseId(),"GET","/internal/v1/forward-work/"+locator.requestId()+"/binding",null,new TypeReference<OperationBinding>() {
        }
        ));
        if(!locator.equals(result.locator())||result.actor().enterpriseId()!=locator.enterpriseId())throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        return result;
    }
    @Override public ForwardOperation prepare(ForwardActor actor,long source,ForwardInput input) {
        return call(actor,"POST","/internal/v1/group-chats/"+source+"/forward-requests",input,new TypeReference<ForwardOperation>() {
        }
        );
    }
    @Override public ForwardOperation completeText(ForwardActor actor,long source,long request) {
        return call(actor,"POST",path(source,request)+"/complete-text",Map.of(),new TypeReference<ForwardOperation>(){});
    }
    @Override public ForwardOperation status(ForwardActor actor,long source,long request) {
        return node.request(new TenantRequestContext(actor.userId(),actor.enterpriseId(),null),"GET",path(source,request),null,new TypeReference<ForwardOperation>() {
        }
        );
    }
    @Override public ForwardOperation retry(ForwardActor actor,long source,long request,Set<Long> groups) {
        return call(actor,"POST",path(source,request)+"/retry",Map.of("targetSessionIds",groups.stream().sorted().map(String::valueOf).toList()),new TypeReference<ForwardOperation>() {
        }
        );
    }
    @Override public RequestLease claimRequest(ForwardOperationLocator locator,String owner,Duration duration) {
        var binding=inspect(locator);
        return call(binding.actor(),"POST",path(binding.sourceSessionId(),locator.requestId())+"/lease",new Claim(owner,duration.toMillis()),new TypeReference<RequestLease>() {
        }
        );
    }
    @Override public TargetLease claimTarget(ForwardOperationLocator locator,long target,String owner,Duration duration) {
        var binding=inspect(locator);
        return call(binding.actor(),"POST",path(binding.sourceSessionId(),locator.requestId())+"/targets/"+target+"/lease",new Claim(owner,duration.toMillis()),new TypeReference<TargetLease>() {
        }
        );
    }
    private OperationBinding bound(RequestLease lease) {
        var binding=inspect(new ForwardOperationLocator(lease.actor().enterpriseId(),lease.requestId(),ForwardBackend.TENANT));
        if(!binding.actor().equals(lease.actor()))throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        return binding;
    }
    @Override public RequestLease renewRequest(RequestLease lease,Duration duration) {
        var b=bound(lease);
        return call(b.actor(),"PATCH",path(b.sourceSessionId(),lease.requestId())+"/lease",new Renew<>(lease,duration.toMillis()),new TypeReference<RequestLease>() {
        }
        );
    }
    @Override public TargetLease renewTarget(TargetLease lease,Duration duration) {
        // The owning Node route and transaction validate the complete target lease binding.
        return call(lease.actor(),"PATCH",path(lease)+"/lease",new Renew<>(lease,duration.toMillis()),new TypeReference<TargetLease>() {
        }
        );
    }
    @Override public void freezeSources(RequestLease lease,FreezeCompletion completion) {
        for(var proof:completion.proofs())if(proof.size()>properties.effectiveMaxFileBytes())throw new IllegalArgumentException("FORWARD_FILE_TOO_LARGE");
        var b=bound(lease);
        call(b.actor(),"POST",path(b.sourceSessionId(),lease.requestId())+"/source-proofs",new Freeze(lease,completion),new TypeReference<JsonNode>() {
        }
        );
    }
    @Override public TargetLease checkpointAttachment(TargetLease lease,long version,AttachmentCheckpointPatch patch) {
        // The owning Node route and transaction validate the complete target lease binding.
        return call(lease.actor(),"PATCH",path(lease)+"/attachments/"+patch.object().attachmentId(),new Patch(lease,version,patch),new TypeReference<TargetLease>() {
        }
        );
    }
    @Override public void failTarget(TargetLease lease,String code,boolean retryable) {
        node.serviceRequest(lease.actor().enterpriseId(),"POST","/internal/v1/forward-maintenance/failure",Map.of("lease",lease,"code",code,"retryable",retryable),new TypeReference<JsonNode>(){});
    }
    @Override public void failRequest(RequestLease lease,String code,boolean retryable) {
        node.serviceRequest(lease.actor().enterpriseId(),"POST","/internal/v1/forward-maintenance/request-failure",Map.of("lease",lease,"code",code,"retryable",retryable),new TypeReference<JsonNode>(){});
    }
    @Override public CommitResult commit(TargetLease lease) {
        // The owning Node route and transaction validate the complete target lease binding.
        // Unknown transport outcomes propagate; the caller retries this stable target receipt, never a new batch.
        return call(lease.actor(), "POST", path(lease)+"/commit", new LeaseBody<>(lease), new TypeReference<CommitResult>() { });
    }
    @Override public TargetLease markReady(TargetLease lease) {
        // The owning Node route and transaction validate the complete target lease binding.
        return call(lease.actor(),"POST",path(lease)+"/ready",new LeaseBody<>(lease),new TypeReference<TargetLease>() {
        }
        );
    }
    @Override public ForwardWork requestWork(RequestLease lease) {
        var b=bound(lease);
        return call(b.actor(),"POST",path(b.sourceSessionId(),lease.requestId())+"/work",new LeaseBody<>(lease),new TypeReference<ForwardWork>() {
        }
        );
    }
    @Override public ForwardWork targetWork(TargetLease lease) {
        // The owning Node route and transaction validate the complete target lease binding.
        return call(lease.actor(),"POST",path(lease)+"/work",new LeaseBody<>(lease),new TypeReference<ForwardWork>() {
        }
        );
    }
    @Override public SourceMessage source(RequestLease lease,long selected) {
        var b=bound(lease);
        var result=call(b.actor(),"POST",path(b.sourceSessionId(),lease.requestId())+"/sources/"+selected,new LeaseBody<>(lease),new TypeReference<JsonNode>() {
        }
        );
        return ForwardSourceProjection.fromNode(result,b.actor());
    }
    @Override public SourceMessage source(TargetLease lease,long selected) {
        // The owning Node route and transaction validate the complete target lease binding.
        var result=call(lease.actor(),"POST",path(lease)+"/sources/"+selected,new LeaseBody<>(lease),new TypeReference<JsonNode>() {
        }
        );
        return ForwardSourceProjection.fromNode(result,lease.actor());
    }
    // Durations are bounded counters, not business identifiers; TenantNodeClient otherwise stringifies Long values.
    private record Claim(String owner,@com.fasterxml.jackson.databind.annotation.JsonSerialize(using=com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec.LongNumberSerializer.class) long durationMs) {
    }
    private record Renew<T>(T lease,@com.fasterxml.jackson.databind.annotation.JsonSerialize(using=com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec.LongNumberSerializer.class) long durationMs) {
    }
    private record LeaseBody<T>(T lease) {
    }
    private record Freeze(RequestLease lease,FreezeCompletion completion) {
    }
    private record Patch(TargetLease lease,long expectedVersion,AttachmentCheckpointPatch patch) {
    }
}
