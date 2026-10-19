package com.iwhalecloud.byai.state.domain.groupchat.forward.application;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyGroupChatForwardStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.GroupChatForwardStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardManifest;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import org.springframework.stereotype.Service;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
/** Remote source reads and ordinary uploads run outside transactions; stores own each short durable transition. */
@Service
public class GroupChatForwardService {
    private final LegacyGroupChatForwardStore legacy;
    private final TenantGroupForwardService tenant;
    private final GroupChatForwardExecutionContextService contexts;
    private final ForwardPlatformPolicy policy;
    private final ForwardSourceResolver resolver;
    private final ForwardReferenceClassifier classifier;
    private final GroupChatForwardAttachmentService attachments;
    private final ForwardUploadReservation locations;
    private final GroupChatForwardProperties properties;
    /** Locator is server-owned; success replay is bound before delegating to the owning final transaction. */
    public CommitResult commit(ForwardOperationLocator locator, TargetLease lease) {
        var store = contexts.store(locator);
        var binding = store.inspect(locator);
        if (lease.requestId() != locator.requestId() || !lease.actor().equals(binding.actor())
            || lease.sourceSessionId() != binding.sourceSessionId()) throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        return store.commit(lease);
    }
    public GroupChatForwardService(LegacyGroupChatForwardStore legacy,TenantGroupForwardService tenant,GroupChatForwardExecutionContextService contexts,ForwardPlatformPolicy policy,ForwardSourceResolver resolver,ForwardReferenceClassifier classifier,GroupChatForwardAttachmentService attachments,ForwardUploadReservation locations,GroupChatForwardProperties properties) {
        this.legacy=legacy;
        this.tenant=tenant;
        this.contexts=contexts;
        this.policy=policy;
        this.resolver=resolver;
        this.classifier=classifier;
        this.attachments=attachments;
        this.locations=locations;
        this.properties=properties;
    }
    private GroupChatForwardStore interactive(ForwardActor actor) {
        var current=TenantRequestContextHolder.get();
        if(current==null)return legacy;
        if(current.userId()!=actor.userId()||current.enterpriseId()!=actor.enterpriseId())throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        return tenant;
    }
    public ForwardOperation create(ForwardActor actor,long source,ForwardInput input) {
        var store=interactive(actor);
        policy.requireNewWork(actor,store==tenant?ForwardBackend.TENANT:ForwardBackend.LEGACY);
        return store.prepare(actor,source,input);
    }
    public ForwardOperation status(ForwardActor actor,long source,long request) {
        return interactive(actor).status(actor,source,request);
    }
    public ForwardOperation retry(ForwardActor actor,long source,long request,Set<Long> targets) {
        return interactive(actor).retry(actor,source,request,targets);
    }
    public ClaimedWork claimWork(ForwardBackend backend,long enterprise,String after,int limit,Duration duration) {
        var store=backend==ForwardBackend.LEGACY?legacy:tenant;
        var page=store.discoverWork(enterprise,after,limit);
        List<TargetLease> leases=new ArrayList<>();
        for(var candidate:page.candidates()) {
            if(!candidate.sourcesFrozen())continue;
            try {
                contexts.resume(candidate.locator(),ForwardPhase.COPY);
                leases.add(store.claimTarget(candidate.locator(),candidate.targetId(),"copy-"+UUID.randomUUID(),duration));
            }
            catch(IllegalArgumentException error) {
                // A discovery page is advisory; later contention or revoked actors do not discard earlier leases.
                if (!"FORWARD_LEASE_LOST".equals(error.getMessage())
                    && !"RESOURCE_NOT_ACCESSIBLE".equals(error.getMessage())
                    && !"FORWARD_TENANT_NOT_READY".equals(error.getMessage())) throw error;
            }
        }
        return new ClaimedWork(leases,page.nextCursor(),page.hasMore());
    }
    private static SourceMessage part(SourceMessage message,PreparedCandidate candidate) {
        if(candidate.address().currentItemId()==null||message.authority()!=null&&candidate.address().currentItemId().equals(message.authority().currentItemId()))return message;
        return message.mergedItems().stream().filter(m->m.authority()!=null&&candidate.address().currentItemId().equals(m.authority().currentItemId())).findFirst().orElseThrow(()->new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE"));
    }
    private ResolvedSource resolve(ForwardActor actor,SourceMessage message,PreparedCandidate candidate) {
        var source=part(message,candidate);
        var value=new SourceCandidate(candidate.itemKey(),candidate.selectedMessageId(),candidate.kind(),Map.of(),candidate.address());
        if(candidate.kind()==SourceKind.UNRESOLVED_REFERENCE) {
            var classified=classifier.classify(actor,source,value);
            return classified.disposition()==ForwardReferenceClassifier.Disposition.FILE?classified.file():null;
        }
        return resolver.resolve(actor,source,value);
    }
    /** Request proof renewal and final freeze share one local monitor; a lost control result never adopts another claim. */
    public void resolveRequest(ForwardOperationLocator locator,Duration duration) {
        var store=contexts.store(locator);
        contexts.resume(locator,ForwardPhase.RESOLVE);
        var claimed=store.claimRequest(locator,"resolve-"+UUID.randomUUID(),duration);
        var streamCancellation=new ForwardStreamCancellation();
        final class Handle {
            RequestLease lease=claimed;
            RuntimeException failure;
            boolean sealed;
            synchronized RequestLease current() {
                if(failure!=null)throw failure;
                if(sealed)throw new IllegalStateException("FORWARD_LEASE_LOST");
                return lease;
            }
            synchronized void renew() {
                if(sealed||failure!=null)return;
                try {
                    var next=store.renewRequest(lease,duration);
                    if(!next.actor().equals(lease.actor())||next.requestId()!=lease.requestId()||!next.owner().equals(lease.owner())||next.fencingVersion()!=lease.fencingVersion()||next.leaseUntil().isBefore(lease.leaseUntil()))throw new IllegalStateException("FORWARD_LEASE_LOST");
                    lease=next;
                }
                catch(RuntimeException e) {
                    failure=e;
                    streamCancellation.close();
                }
            }
            synchronized void freeze(FreezeCompletion completion) {
                var latest=current();
                sealed=true;
                store.freezeSources(latest,completion);
            }
            synchronized void close() {
                sealed=true;
            }
        }
        var handle=new Handle();
        var renewal=Executors.newSingleThreadScheduledExecutor();
        long period=Math.max(1,duration.toMillis()/3);
        renewal.scheduleAtFixedRate(handle::renew,period,period,TimeUnit.MILLISECONDS);
        try {
            var work=store.requestWork(handle.current());
            List<SourceProof> proofs=new ArrayList<>();
            List<CandidateResolution> resolutions=new ArrayList<>();
            Map<SourceIdentity,SourceProof> frozen=new HashMap<>();
            for(var candidate:work.manifest().candidates()) {
                contexts.resume(locator,ForwardPhase.RESOLVE);
                var message=store.source(handle.current(),candidate.selectedMessageId());
                var source=resolve(work.actor(),message,candidate);
                if(source==null) {
                    resolutions.add(new CandidateResolution(candidate.candidateId(),null));
                    continue;
                }
                var proof=frozen.get(source.identity());
                if(proof==null) {
                    proof=attachments.freezeProof(work.actor(),source,streamCancellation);
                    frozen.put(source.identity(),proof);
                    proofs.add(proof);
                }
                resolutions.add(new CandidateResolution(candidate.candidateId(),proof.sourceId()));
            }
            renewal.shutdown();
            handle.freeze(new FreezeCompletion(proofs,resolutions));
        }
        catch(RuntimeException failure) {
            try{store.failRequest(claimed,GroupChatForwardRecoveryService.errorCode(failure),retryable(failure));}catch(RuntimeException ignored){/* Lost or unknown ownership never overwrites newer work. */}
            throw failure;
        }
        finally {
            renewal.shutdownNow();
            handle.close();
            streamCancellation.close();
        }
    }
    /** Returns a live READY lease for Task8; no final message publication happens in this coordinator. */
    public TargetLease copyTarget(ForwardOperationLocator locator,TargetLease claimed,Duration duration) {
        var store=contexts.store(locator);
        try(var preparation=new ForwardPreparationLease(claimed,store,duration)) {
            contexts.resume(locator,preparation.current(),ForwardPhase.COPY);
            var work=store.targetWork(preparation.current());
            if(claimed.state()==ForwardState.READY)return preparation.handoff();
            var budget=new ForwardCopyBudget(properties);
            for(var b:work.manifest().attachments()) {
                var p=ForwardManifest.proof(work.manifest(),b.sourceId());
                budget.reserve(locator.requestId(),Long.parseLong(b.targetId()),b.itemId(),b.attachmentId(),p.size());
            }
            List<PreparedForwardSource> prepared=new ArrayList<>();
            for(var binding:work.manifest().attachments().stream().filter(a->a.targetId().equals(Long.toString(claimed.targetId()))).toList()) {
                boolean verified=false;
                for(var attempt:work.target().checkpoint().path("attempts"))if("VERIFIED".equals(attempt.path("state").asText())&&binding.itemId().equals(attempt.path("object").path("itemId").asText())&&binding.attachmentId().equals(attempt.path("object").path("attachmentId").asText()))verified=true;
                if(verified)continue;
                var proof=ForwardManifest.proof(work.manifest(),binding.sourceId());
                ResolvedSource first=null;
                List<CandidateAddress> addresses=new ArrayList<>();
                for(String id:binding.candidateIds()) {
                    var candidate=work.manifest().candidates().stream().filter(c->c.candidateId().equals(id)).findFirst().orElseThrow();
                    contexts.resume(locator,ForwardPhase.COPY);
                    var source=resolve(work.actor(),store.source(preparation.current(),candidate.selectedMessageId()),candidate);
                    if(source==null||!source.identity().equals(proof.identity()))throw new IllegalArgumentException("FORWARD_SOURCE_CHANGED");
                    if(first==null)first=source;
                    addresses.add(candidate.address());
                }
                prepared.add(new PreparedForwardSource(binding.itemId(),binding.attachmentId(),proof,Objects.requireNonNull(first),binding.referenceKeys(),addresses));
            }
            var handle=new DefaultForwardTargetCopyHandle(preparation.handoff(),store,prepared,budget);
            var renewal=Executors.newSingleThreadScheduledExecutor();
            var workers=Executors.newFixedThreadPool(Math.max(1,Math.min(2,properties.getParallelFiles())));
            final class CopyExecution {
                final List<FutureTask<Void>> tasks = new ArrayList<>();
                RuntimeException renewalFailure;

                synchronized void submit(Runnable copy) {
                    checkFailure();
                    // Register before execute under the same monitor as abort: no queued future can escape cancellation.
                    var task = new FutureTask<Void>(copy, null);
                    tasks.add(task);
                    workers.execute(task);
                }

                synchronized void failedRenewal(RuntimeException failure) {
                    if (renewalFailure == null) renewalFailure = failure;
                    cancel();
                }

                synchronized void checkFailure() {
                    if (renewalFailure != null) throw new IllegalStateException("FORWARD_COPY_FAILED", renewalFailure);
                }

                synchronized void cancel() {
                    tasks.forEach(task -> task.cancel(true));
                    workers.shutdownNow();
                }
            }
            var execution = new CopyExecution();
            long period = Math.max(1, duration.toMillis() / 3);
            renewal.scheduleAtFixedRate(() -> {
                try {
                    handle.renew(duration);
                } catch (RuntimeException failure) {
                    execution.failedRenewal(failure);
                    handle.close();
                }
            }, period, period, TimeUnit.MILLISECONDS);
            try {
                for (var source : prepared) execution.submit(() -> {
                    var item = work.target().items().stream().filter(i -> i.itemId().equals(source.itemId()))
                        .findFirst().orElseThrow();
                    var allocated = locations.allocate(work.actor().enterpriseId(), claimed.targetSessionId(),
                        claimed.targetId(), source.itemId(), source.attachmentId(), source.resolved().fileName());
                    attachments.copy(handle, item, source.proof(), allocated);
                });
                for (var task : execution.tasks) task.get();
                workers.shutdown();
                renewal.shutdown();
                // Join any already-started renewal before sealing and handing its last acknowledged lease to READY.
                while (!renewal.awaitTermination(1, TimeUnit.SECONDS)) execution.checkFailure();
                execution.checkFailure();
                return store.markReady(handle.handoff());
            }
            catch(CancellationException failure) {
                execution.checkFailure();
                throw new IllegalStateException("FORWARD_COPY_FAILED",failure);
            }
            catch(RuntimeException failure) {
                try{store.failTarget(handle.lastAcknowledged(),GroupChatForwardRecoveryService.errorCode(failure),retryable(failure));}catch(RuntimeException ignored){/* CAS failure preserves the current owner or success receipt. */}
                throw failure;
            }
            catch(InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("FORWARD_COPY_INTERRUPTED",e);
            }
            catch(ExecutionException e) {
                try{store.failTarget(handle.lastAcknowledged(),GroupChatForwardRecoveryService.errorCode(e),retryable(e));}catch(RuntimeException ignored){/* Last acknowledged fence only. */}
                throw new IllegalStateException("FORWARD_COPY_FAILED",e.getCause());
            }
            finally {
                handle.close();
                execution.cancel();
                renewal.shutdownNow();
            }
        }
        catch(RuntimeException failure) {
            try{store.failTarget(claimed,GroupChatForwardRecoveryService.errorCode(failure),retryable(failure));}catch(RuntimeException ignored){/* Preparation may have lost its fence; never adopt the replacement. */}
            throw failure;
        }
    }
    private static boolean retryable(Throwable error){return !Set.of("RESOURCE_NOT_ACCESSIBLE","FORWARD_SOURCE_CHANGED","FORWARD_RESOURCE_UNRESOLVABLE","FORWARD_FILE_TOO_LARGE").contains(GroupChatForwardRecoveryService.errorCode(error));}

}
