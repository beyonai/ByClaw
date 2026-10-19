package com.iwhalecloud.byai.state.domain.groupchat.forward.application;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardMaintenanceStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
/** Bounded fair discovery dispatches real owning-store claims; no transaction surrounds network/file/socket work. */
@Service
public class GroupChatForwardRecoveryService {
    private static final Logger LOG=LoggerFactory.getLogger(GroupChatForwardRecoveryService.class);
    private final ForwardRecoveryDirectory directory;private final LegacyForwardMaintenanceStore legacy;
    private final TenantForwardMaintenanceStore tenant;private final GroupChatForwardExecutionContextService contexts;
    private final GroupChatForwardService forwards;private final ForwardDeliveryPublisher publisher;
    private final GroupChatForwardProperties properties;
    private final ExecutorService workers=Executors.newFixedThreadPool(4,r->{var t=new Thread(r,"forward-recovery");t.setDaemon(true);return t;});
    private final Semaphore capacity=new Semaphore(4);private final Map<String,String> cursors=new HashMap<>();
    private long legacyCursor,tenantCursor;private final Map<String,Integer> categories=new HashMap<>();
    private record AwaitingDatabase(ForwardMaintenanceStore store,long enterprise,ForwardBackend backend) { }
    private final Deque<AwaitingDatabase> awaitingDatabases=new ArrayDeque<>();
    public GroupChatForwardRecoveryService(ForwardRecoveryDirectory directory,LegacyForwardMaintenanceStore legacy,TenantForwardMaintenanceStore tenant,GroupChatForwardExecutionContextService contexts,GroupChatForwardService forwards,ForwardDeliveryPublisher publisher,GroupChatForwardProperties properties){this.directory=directory;this.legacy=legacy;this.tenant=tenant;this.contexts=contexts;this.forwards=forwards;this.publisher=publisher;this.properties=properties;}
    @Scheduled(initialDelayString="${group-chat.forward.recovery-delay-millis:30000}",fixedDelayString="${group-chat.forward.recovery-delay-millis:30000}")
    public void scheduled(){recover(Instant.now(),properties.getRecoveryBatchSize());}
    @jakarta.annotation.PreDestroy public void close(){workers.shutdownNow();}
    public synchronized void recover(Instant now,int batchSize) {
        Objects.requireNonNull(now);
        if(batchSize<1)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        properties.validateRecovery();
        int limit=Math.min(20,batchSize);
        // Retain both database priority and its category while all workers are occupied.
        if(capacity.availablePermits()==0)return;
        if(awaitingDatabases.isEmpty()) {
            // One legacy enterprise per page keeps the shared database within one bounded scan.
            var locals=directory.legacyEnterprises(legacyCursor,1);
            if(locals.isEmpty())legacyCursor=0;
            else {
                legacyCursor=locals.getFirst();
                awaitingDatabases.addLast(new AwaitingDatabase(legacy,legacyCursor,ForwardBackend.LEGACY));
            }
            var tenants=directory.readyTenants(tenantCursor,4);
            if(tenants.isEmpty())tenantCursor=0;
            for(long id:tenants) {
                tenantCursor=id;
                awaitingDatabases.addLast(new AwaitingDatabase(tenant,id,ForwardBackend.TENANT));
            }
        }
        // A database that consumes this tick's capacity yields to every already-discovered peer next.
        // At most this one bounded directory page is drained; it is never refilled within the same tick.
        while(!awaitingDatabases.isEmpty()&&capacity.availablePermits()>0) {
            var database=awaitingDatabases.removeFirst();
            discover(database.store(),database.enterprise(),database.backend(),limit);
        }
    }
    private void discover(ForwardMaintenanceStore store,long enterprise,ForwardBackend backend,int limit){
        String database=backend+":"+enterprise;int index=categories.getOrDefault(database,0);Category category=index==0?Category.WORK:Category.DELIVERY;categories.put(database,(index+1)%2);
        String key=database+":"+category;
        try{
            var page=store.scan(enterprise,category,cursors.get(key),limit);
            // Never advance past an unadmitted candidate: later scans must see it again.
            for(var candidate:page.candidates()){
                if(!capacity.tryAcquire())return;
                try{workers.execute(()->{try{process(store,candidate,category);}catch(RuntimeException error){LOG.warn("Forward recovery deferred, code={}",errorCode(error));}finally{capacity.release();}});}catch(RuntimeException rejected){capacity.release();throw rejected;}
                cursors.put(key,Long.toString(candidate.targetId()));
            }
            if(page.nextCursor()==null)cursors.remove(key);
        }catch(RuntimeException error){LOG.warn("Forward recovery discovery deferred, code={}",errorCode(error));}
    }
    /** Called with a server-discovered candidate; store authority and current policy are rechecked at each phase. */
    public void process(ForwardMaintenanceStore store,Candidate candidate,Category category){
        var locator=candidate.locator();Duration duration=Duration.ofSeconds(properties.getWorkerLeaseSeconds());
        if(category==Category.WORK){
            var owning=contexts.store(locator);
            if(!candidate.sourcesFrozen())forwards.resolveRequest(locator,duration);
            contexts.resume(locator,ForwardPhase.COPY);
            var claimed=owning.claimTarget(locator,candidate.targetId(),"copy-"+UUID.randomUUID(),duration);
            var ready=forwards.copyTarget(locator,claimed,duration);
            // A failed/unknown commit is never translated to FAILED or recreated; the next scan reads its receipt.
            try{contexts.resume(locator,ForwardPhase.COMMIT);}catch(RuntimeException failure){
                try{store.failTarget(ready,errorCode(failure),false);}catch(RuntimeException ignored){/* Exact acknowledged fence only. */}
                throw failure;
            }
            forwards.commit(locator,ready);
            return;
        }
        contexts.resumeMaintenance(locator,candidate.targetId(),ForwardPhase.DELIVERY);
        if(category==Category.DELIVERY){
            var lease=store.claimDelivery(locator,candidate.targetId(),"delivery-"+UUID.randomUUID(),duration);if(lease==null)return;
            for(String message:new ArrayList<>(lease.pendingMessageIds())){
                lease=store.renewDelivery(lease,duration);
                var delivery=store.delivery(lease,Long.parseLong(message));
                if(delivery!=null)publisher.publish(delivery);
                lease=store.markDelivered(lease,Long.parseLong(message),delivery==null?Outcome.SUPPRESSED:Outcome.ENQUEUED);
            }
            return;
        }
    }
    public static String errorCode(Throwable error){for(Throwable e=error;e!=null;e=e.getCause()){String code=e.getMessage();if(code!=null&&code.matches("RESOURCE_NOT_ACCESSIBLE|FORWARD_[A-Z_]+"))return code;}return "FORWARD_WORK_UNAVAILABLE";}
}
