package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import java.time.Duration;
import java.util.*;

/** Serializes only control calls; file streams never hold this monitor. Unknown outcomes stop the claim. */
public final class DefaultForwardTargetCopyHandle implements ForwardTargetCopyHandle {
    private final AttachmentCheckpointWriter writer;
    private final List<PreparedForwardSource> sources;
    private final ForwardCopyBudget budget;
    private TargetLease lease;
    private boolean closed;
    private final ForwardStreamCancellation cancellation=new ForwardStreamCancellation();
    @Override public ForwardStreamCancellation cancellation(){return cancellation;}
    private record CopyJob(com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile allocated,
        java.util.concurrent.CompletableFuture<com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile> result) { }
    private final java.util.concurrent.ConcurrentMap<List<String>,CopyJob> copies = new java.util.concurrent.ConcurrentHashMap<>();

    public DefaultForwardTargetCopyHandle(TargetLease lease, AttachmentCheckpointWriter writer,
            List<PreparedForwardSource> sources, ForwardCopyBudget budget) {
        this.lease = Objects.requireNonNull(lease); this.writer = Objects.requireNonNull(writer);
        if (sources.size() > 100) throw new IllegalArgumentException("FORWARD_TOO_MANY_ATTACHMENTS");
        this.sources = List.copyOf(sources); this.budget = Objects.requireNonNull(budget);
        Set<List<String>> keys = new HashSet<>();
        for (var source : sources) {
            var message = source.resolved().source();
            if (message != null && (message.authority() == null || !message.authority().actor().equals(lease.actor())
                || message.authority().sourceSessionId() != lease.sourceSessionId())) throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
            if (!keys.add(List.of(source.itemId(), source.attachmentId()))
                || source.proof().identity().enterpriseId() != lease.actor().enterpriseId())
                throw new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE");
        }
    }
    /** Failure recording may use only this last acknowledged fence; it grants no new copy authority. */
    public synchronized TargetLease lastAcknowledged(){return lease;}
    @Override public ForwardCopyBudget budget() { return budget; }
    @Override public synchronized TargetLease current() { requireOpen(); return lease; }
    @Override public synchronized PreparedForwardSource requireSource(String item, String attachment, String sourceId) {
        requireOpen();
        return sources.stream().filter(source -> source.itemId().equals(item)
            && source.attachmentId().equals(attachment) && source.proof().sourceId().equals(sourceId))
            .findFirst().orElseThrow(() -> new IllegalArgumentException("FORWARD_RESOURCE_UNRESOLVABLE"));
    }
    /** Alias callers share one result in this claim; distinct items have distinct copies and object keys. */
    @Override public com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile copyOnce(com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile allocated,
            java.util.function.Supplier<com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile> work) {
        current();
        var future = new java.util.concurrent.CompletableFuture<com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile>();
        var existing = copies.putIfAbsent(List.of(allocated.itemId(), allocated.attachmentId()), new CopyJob(allocated, future));
        if (existing != null) {
            if (!allocated.equals(existing.allocated())) { close(); throw new IllegalArgumentException("FORWARD_ATTEMPT_CONFLICT"); }
            try { var result = existing.result().join(); current(); return result; }
            catch (java.util.concurrent.CompletionException failure) { if (failure.getCause() instanceof RuntimeException cause) throw cause; throw failure; }
        }
        try { var result = work.get(); future.complete(result); return result; }
        catch (RuntimeException | Error failure) { close(); future.completeExceptionally(failure); throw failure; }
    }
    @Override public synchronized TargetLease checkpoint(AttachmentCheckpointPatch patch) {
        requireOpen();
        try { return accept(writer.checkpointAttachment(lease, lease.fencingVersion(), patch), true); }
        catch (RuntimeException | Error failure) { closed = true; throw failure; }
    }
    @Override public synchronized TargetLease renew(Duration duration) {
        requireOpen();
        try { return accept(writer.renewTarget(lease, duration), false); }
        catch (RuntimeException | Error failure) { closed = true; throw failure; }
    }
    private TargetLease accept(TargetLease next, boolean advanced) {
        if (next == null || next.requestId() != lease.requestId() || next.targetId() != lease.targetId()
            || !next.actor().equals(lease.actor()) || next.sourceSessionId() != lease.sourceSessionId()
            || next.targetSessionId() != lease.targetSessionId() || !Objects.equals(next.owner(), lease.owner())
            || next.fencingVersion() != Math.addExact(lease.fencingVersion(), advanced ? 1 : 0)
            || next.leaseUntil() == null || next.leaseUntil().isBefore(lease.leaseUntil())
            || next.state() != lease.state()) throw lost();
        lease = next;
        return next;
    }
    @Override public synchronized TargetLease handoff() { requireOpen(); closed = true; return lease; }
    @Override public void close() { synchronized(this){closed=true;} cancellation.close(); }
    private void requireOpen() { if (closed) throw lost(); cancellation.check(); }
    private static IllegalStateException lost() { return new IllegalStateException("FORWARD_LEASE_LOST"); }
}
