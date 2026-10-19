package com.iwhalecloud.byai.state.domain.groupchat.forward.application;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardMaintenanceStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.ForwardOperationLocator;
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
    private final ExecutorService workers=pool(4,"forward-recovery");
    private final ExecutorService tenantWorkers=pool(2,"forward-tenant-work");
    private final ExecutorService tenantDiscovery=pool(1,"forward-tenant-discovery");
    // Permits bound running plus queued requests; fixed workers consume queued work immediately when free.
    private final Semaphore capacity=new Semaphore(68),tenantCapacity=new Semaphore(66);
    private final ExecutorService deliveries=pool(2,"forward-delivery");
    private final Semaphore deliveryCapacity=new Semaphore(66);
    private final Set<String> runningDeliveries=ConcurrentHashMap.newKeySet();
    private final Set<ForwardOperationLocator> deliveryRequests=ConcurrentHashMap.newKeySet();
    private final java.util.concurrent.atomic.AtomicBoolean tenantScanRunning=new java.util.concurrent.atomic.AtomicBoolean();
    private final Set<ForwardOperationLocator> runningRequests=ConcurrentHashMap.newKeySet();
    private final Map<String,String> cursors=new ConcurrentHashMap<>();
    private long legacyCursor,tenantCursor;
    private final Map<String,Integer> categories=new ConcurrentHashMap<>();
    private final Deque<Long> awaitingTenants=new ArrayDeque<>();
    private static ExecutorService pool(int size,String name){return Executors.newFixedThreadPool(size,r->{var t=new Thread(r,name);t.setDaemon(true);return t;});}
    public GroupChatForwardRecoveryService(ForwardRecoveryDirectory directory,LegacyForwardMaintenanceStore legacy,TenantForwardMaintenanceStore tenant,GroupChatForwardExecutionContextService contexts,GroupChatForwardService forwards,ForwardDeliveryPublisher publisher,GroupChatForwardProperties properties){this.directory=directory;this.legacy=legacy;this.tenant=tenant;this.contexts=contexts;this.forwards=forwards;this.publisher=publisher;this.properties=properties;}
    @Scheduled(initialDelayString="${group-chat.forward.recovery-delay-millis:30000}",fixedDelayString="${group-chat.forward.recovery-delay-millis:30000}")
    public void scheduled(){recover(Instant.now(),properties.getRecoveryBatchSize());}
    @jakarta.annotation.PreDestroy public void close(){workers.shutdownNow();tenantWorkers.shutdownNow();tenantDiscovery.shutdownNow();deliveries.shutdownNow();}

    /** 事务提交后仅入队；容量不足或进程退出时，持久化请求由定时补偿再次发现。 */
    public boolean submitRequest(ForwardOperationLocator locator){
        if(!runningRequests.add(locator))return true;
        var permits=locator.backend()==ForwardBackend.LEGACY?capacity:tenantCapacity;
        var executor=locator.backend()==ForwardBackend.LEGACY?workers:tenantWorkers;
        if(!permits.tryAcquire()){runningRequests.remove(locator);LOG.warn("Forward work queue full, backend={}, enterprise={}, request={}",locator.backend(),locator.enterpriseId(),locator.requestId());return false;}
        try{executor.execute(()->{try{executeRequest(locator);}catch(RuntimeException error){LOG.warn("Forward execution deferred, backend={}, enterprise={}, request={}, code={}",locator.backend(),locator.enterpriseId(),locator.requestId(),errorCode(error));}finally{runningRequests.remove(locator);permits.release();}});return true;}
        catch(RuntimeException rejected){runningRequests.remove(locator);permits.release();LOG.warn("Forward dispatch deferred, backend={}, enterprise={}, request={}",locator.backend(),locator.enterpriseId(),locator.requestId());return false;}
    }
    private void executeRequest(ForwardOperationLocator locator){
        var page=contexts.store(locator).discoverRequestWork(locator);
        if(page.candidates().isEmpty())return;
        Duration duration=Duration.ofSeconds(properties.getWorkerLeaseSeconds());
        if(page.candidates().stream().anyMatch(c->!c.deliveryOnly()&&!c.sourcesFrozen()))forwards.resolveRequest(locator,duration);
        var store=locator.backend()==ForwardBackend.LEGACY?legacy:tenant;
        // 同一请求只冻结一次来源，各目标依次申请各自租约；一个目标失败不丢弃其余目标。
        for(var candidate:page.candidates()){
            if(!candidate.locator().equals(locator))throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
            if(candidate.deliveryOnly()){submitDelivery(store,new Candidate(locator,candidate.targetId(),true));continue;}
            try{process(store,new Candidate(locator,candidate.targetId(),true),Category.WORK);}
            catch(RuntimeException error){LOG.warn("Forward target deferred, backend={}, enterprise={}, request={}, target={}, code={}",locator.backend(),locator.enterpriseId(),locator.requestId(),candidate.targetId(),errorCode(error));}
        }
    }
    /** Successful text forwards discover delivery on a separate executor, even while every copy worker is occupied. */
    public boolean submitDeliveryRequest(ForwardOperationLocator locator) {
        if(!deliveryRequests.add(locator))return true;
        if(!deliveryCapacity.tryAcquire()){deliveryRequests.remove(locator);return false;}
        try {
            deliveries.execute(()->{
                try {
                    var store=locator.backend()==ForwardBackend.LEGACY?legacy:tenant;
                    for(var candidate:contexts.store(locator).discoverRequestWork(locator).candidates()) {
                        if(candidate.deliveryOnly())submitDelivery(store,new Candidate(locator,candidate.targetId(),true));
                    }
                } catch(RuntimeException error) { LOG.warn("Forward delivery discovery deferred, request={}, code={}",locator.requestId(),errorCode(error)); }
                finally { deliveryRequests.remove(locator);deliveryCapacity.release(); }
            });
            return true;
        } catch(RuntimeException error) { deliveryRequests.remove(locator);deliveryCapacity.release();return false; }
    }
    private boolean submitDelivery(ForwardMaintenanceStore store,Candidate candidate) {
        String key=candidate.locator()+":"+candidate.targetId();
        if(!runningDeliveries.add(key))return true;
        if(!deliveryCapacity.tryAcquire()){runningDeliveries.remove(key);LOG.warn("Forward delivery queue full, target={}",candidate.targetId());return false;}
        try {
            deliveries.execute(()->{
                try { process(store,candidate,Category.DELIVERY); }
                catch(RuntimeException error) { LOG.warn("Forward delivery deferred, target={}, code={}",candidate.targetId(),errorCode(error)); }
                finally { runningDeliveries.remove(key);deliveryCapacity.release(); }
            });
            return true;
        } catch(RuntimeException error) { runningDeliveries.remove(key);deliveryCapacity.release();return false; }
    }
    public synchronized void recover(Instant now,int batchSize) {
        Objects.requireNonNull(now);
        if(batchSize<1)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        properties.validateRecovery();
        int limit=Math.min(20,batchSize);
        // Node 的发现、网络等待和执行容量均与共享库隔离，调度线程不等待网络调用。
        scheduleTenantScan(limit);
        if(capacity.availablePermits()==0&&deliveryCapacity.availablePermits()==0)return;
        var locals=directory.legacyEnterprises(legacyCursor,1);
        if(locals.isEmpty()&&legacyCursor!=0){legacyCursor=0;locals=directory.legacyEnterprises(0,1);}
        if(!locals.isEmpty()){
            legacyCursor=locals.getFirst();
            discover(legacy,legacyCursor,ForwardBackend.LEGACY,limit);
        }
    }
    private void scheduleTenantScan(int limit){
        if(!tenantScanRunning.compareAndSet(false,true))return;
        try{tenantDiscovery.execute(()->{try{recoverTenants(limit);}catch(RuntimeException error){LOG.warn("Forward tenant discovery deferred, code={}",errorCode(error));}finally{tenantScanRunning.set(false);}});}
        catch(RuntimeException rejected){tenantScanRunning.set(false);LOG.warn("Forward tenant discovery dispatch deferred");}
    }
    private void recoverTenants(int limit){
        if(tenantCapacity.availablePermits()==0&&deliveryCapacity.availablePermits()==0)return;
        if(awaitingTenants.isEmpty()){
            var tenants=directory.readyTenants(tenantCursor,4);
            if(tenants.isEmpty()&&tenantCursor!=0){tenantCursor=0;tenants=directory.readyTenants(0,4);}
            for(long id:tenants){tenantCursor=id;awaitingTenants.addLast(id);}
        }
        // 未扫描的租户保留到下一轮，持续繁忙的前序租户不能饿死后序租户。
        while(!awaitingTenants.isEmpty()&&(tenantCapacity.availablePermits()>0||deliveryCapacity.availablePermits()>0))discover(tenant,awaitingTenants.removeFirst(),ForwardBackend.TENANT,limit);
    }
    private void discover(ForwardMaintenanceStore store,long enterprise,ForwardBackend backend,int limit){
        String database=backend+":"+enterprise;int index=categories.getOrDefault(database,0);Category category=index==0?Category.WORK:Category.DELIVERY;categories.put(database,(index+1)%2);
        var workCapacity=backend==ForwardBackend.LEGACY?capacity:tenantCapacity;
        // Copy backlogs must not suppress delivery recovery, and vice versa.
        if(category==Category.WORK&&workCapacity.availablePermits()==0)category=Category.DELIVERY;
        if(category==Category.DELIVERY&&deliveryCapacity.availablePermits()==0)category=Category.WORK;
        if((category==Category.WORK?workCapacity:deliveryCapacity).availablePermits()==0)return;
        String key=database+":"+category;
        try{
            var page=store.scan(enterprise,category,cursors.get(key),limit);
            for(var candidate:page.candidates()){
                if(category==Category.WORK){if(!submitRequest(candidate.locator()))return;}
                else if(!submitDelivery(store,candidate))return;
                cursors.put(key,Long.toString(candidate.targetId()));
            }
            if(page.nextCursor()==null)cursors.remove(key);
        }catch(RuntimeException error){LOG.warn("Forward recovery discovery deferred, backend={}, enterprise={}, code={}",backend,enterprise,errorCode(error));}
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
            // 提交回执已持久化，投递失败只保留 pending_delivery，不能改写成功结果。
            submitDelivery(store,new Candidate(locator,candidate.targetId(),true));
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
