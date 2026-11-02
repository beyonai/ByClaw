package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure;
import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.state.domain.groupchat.forward.port.ForwardMaintenanceStore;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.TargetLease;
import org.springframework.stereotype.Component;
import java.time.Duration;
import java.util.*;
/** Maintenance transport uses BE service identity; no actor membership is invented for successful delivery. */
@Component
public class TenantForwardMaintenanceStore implements ForwardMaintenanceStore {
    private final TenantNodeClient node;
    public TenantForwardMaintenanceStore(TenantNodeClient node){this.node=node;}
    private <T>T call(long tenant,String path,Object body,TypeReference<T> type){return node.serviceRequest(tenant,"POST","/internal/v1/forward-maintenance/"+path,body,type);}
    @Override public Page scan(long tenant,Category category,String after,int limit){Map<String,Object> body=new HashMap<>();body.put("category",category.name());body.put("after",after);body.put("limit",limit);return call(tenant,"scan",body,new TypeReference<>(){});}
    @Override public DeliveryLease claimDelivery(ForwardOperationLocator l,long target,String owner,Duration d){return call(l.enterpriseId(),"delivery/claim",new Claim(l,target,owner,d.toMillis()),new TypeReference<>(){});}
    @Override public DeliveryLease renewDelivery(DeliveryLease l,Duration d){return call(l.locator().enterpriseId(),"delivery/renew",new Renew(l,d.toMillis()),new TypeReference<>(){});}
    @Override public Delivery delivery(DeliveryLease l,long message){return call(l.locator().enterpriseId(),"delivery/read",Map.of("lease",l,"messageId",Long.toString(message)),new TypeReference<>(){});}
    @Override public DeliveryLease markDelivered(DeliveryLease l,long message,Outcome outcome){return call(l.locator().enterpriseId(),"delivery/mark",Map.of("lease",l,"messageId",Long.toString(message),"outcome",outcome.name()),new TypeReference<>(){});}
    @Override public void failTarget(TargetLease l,String code,boolean retryable){call(l.actor().enterpriseId(),"failure",Map.of("lease",l,"code",code,"retryable",retryable),new TypeReference<Object>(){});}
    private record Claim(ForwardOperationLocator locator,long targetId,String owner,@com.fasterxml.jackson.databind.annotation.JsonSerialize(using=com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec.LongNumberSerializer.class) long durationMs){}
    private record Renew(DeliveryLease lease,@com.fasterxml.jackson.databind.annotation.JsonSerialize(using=com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec.LongNumberSerializer.class) long durationMs){}
}
