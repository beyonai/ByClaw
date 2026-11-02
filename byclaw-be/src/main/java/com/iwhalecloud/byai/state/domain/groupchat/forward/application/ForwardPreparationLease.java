package com.iwhalecloud.byai.state.domain.groupchat.forward.application;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.AttachmentCheckpointWriter;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.TargetLease;
import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.*;
/** Per-claim metadata preparation authority. Only renewal is allowed before immutable copy bindings exist. */
public final class ForwardPreparationLease implements AutoCloseable {
    private final AttachmentCheckpointWriter writer;
    private final Duration duration;
    private final ScheduledExecutorService scheduler=Executors.newSingleThreadScheduledExecutor();
    private TargetLease lease;
    private boolean sealed;
    private RuntimeException failure;
    public ForwardPreparationLease(TargetLease lease,AttachmentCheckpointWriter writer,Duration duration) {
        this.lease=Objects.requireNonNull(lease);
        this.writer=writer;
        this.duration=duration;
        if(duration==null||duration.toMillis()<=0)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        long period=Math.max(1,duration.toMillis()/3);
        scheduler.scheduleAtFixedRate(this::renew,period,period,TimeUnit.MILLISECONDS);
    }
    public synchronized TargetLease current() {
        if(failure!=null)throw failure;
        if(sealed)throw new IllegalStateException("FORWARD_LEASE_LOST");
        return lease;
    }
    public synchronized void renew() {
        if(sealed||failure!=null)return;
        try {
            var next=writer.renewTarget(lease,duration);
            if(next==null||next.requestId()!=lease.requestId()||next.targetId()!=lease.targetId()||!next.actor().equals(lease.actor())||next.sourceSessionId()!=lease.sourceSessionId()||next.targetSessionId()!=lease.targetSessionId()||!Objects.equals(next.owner(),lease.owner())||next.fencingVersion()!=lease.fencingVersion()||next.state()!=lease.state()||next.leaseUntil()==null||next.leaseUntil().isBefore(lease.leaseUntil()))throw new IllegalStateException("FORWARD_LEASE_LOST");
            lease=next;
        }
        catch(RuntimeException error) {
            failure=error;
            sealed=true;
            scheduler.shutdown();
        }
    }
    public TargetLease handoff() {
        // Stop future tasks first; taking the monitor joins an already executing control call before sealing.
        scheduler.shutdown();
        synchronized(this) {
            var result=current();
            sealed=true;
            return result;
        }
    }
    @Override public void close() {
        scheduler.shutdown();
        synchronized(this) {
            sealed=true;
        }
    }
}
