package com.iwhalecloud.byai.state.domain.groupchat.forward.application;
import com.iwhalecloud.byai.manager.domain.tenant.TenantGroupForwardService;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyGroupChatForwardStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.GroupChatForwardStore;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import org.springframework.stereotype.Service;
/** Worker contexts originate from an owning-store locator, never from a thread-local user or request body. */
@Service
public class GroupChatForwardExecutionContextService {
    private final LegacyGroupChatForwardStore legacy;
    private final TenantGroupForwardService tenant;
    private final ForwardPlatformPolicy policy;
    public GroupChatForwardExecutionContextService(LegacyGroupChatForwardStore legacy,TenantGroupForwardService tenant,ForwardPlatformPolicy policy) {
        this.legacy=legacy;
        this.tenant=tenant;
        this.policy=policy;
    }
    public GroupChatForwardStore store(ForwardOperationLocator locator) {
        return locator.backend()==ForwardBackend.LEGACY?legacy:tenant;
    }
    public OperationBinding resume(ForwardOperationLocator locator,ForwardPhase phase) {
        var binding=store(locator).inspect(locator);
        if(!binding.locator().equals(locator))throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        if(phase==ForwardPhase.RESOLVE||phase==ForwardPhase.COPY||phase==ForwardPhase.COMMIT)policy.requireNewWork(binding.actor(),locator.backend());
        return binding;
    }
    public MaintenanceExecutionContext resumeMaintenance(ForwardOperationLocator locator,long targetId,ForwardPhase phase) {
        if(phase!=ForwardPhase.DELIVERY)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        var binding=resume(locator,phase);
        var target=store(locator).inspectTarget(locator,targetId);
        if(target.targetId()!=targetId||phase==ForwardPhase.DELIVERY&&target.state()!=ForwardState.SUCCEEDED)throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        return new MaintenanceExecutionContext(binding,target,phase);
    }
    public RequestExecutionContext resume(ForwardOperationLocator locator,RequestLease lease) {
        var binding=resume(locator,ForwardPhase.RESOLVE);
        if(lease.requestId()!=locator.requestId()||!lease.actor().equals(binding.actor()))throw new IllegalArgumentException("FORWARD_LEASE_LOST");
        store(locator).requestWork(lease);
        return new RequestExecutionContext(binding,lease,ForwardPhase.RESOLVE);
    }
    public TargetExecutionContext resume(ForwardOperationLocator locator,TargetLease lease,ForwardPhase phase) {
        if(phase!=ForwardPhase.COPY&&phase!=ForwardPhase.COMMIT)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        var binding=resume(locator,phase);
        if(lease.requestId()!=locator.requestId()||!lease.actor().equals(binding.actor())||lease.sourceSessionId()!=binding.sourceSessionId()||phase==ForwardPhase.COMMIT&&lease.state()!=ForwardState.READY)throw new IllegalArgumentException("FORWARD_LEASE_LOST");
        store(locator).targetWork(lease);
        return new TargetExecutionContext(binding,lease,phase);
    }
}
