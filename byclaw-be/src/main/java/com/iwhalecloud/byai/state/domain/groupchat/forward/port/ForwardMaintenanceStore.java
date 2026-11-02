package com.iwhalecloud.byai.state.domain.groupchat.forward.port;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.*;
import static com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.TargetLease;
import java.time.Duration;
import java.util.*;
/** Every operation remains bound to the owning backend; scanner results grant no source or copy permission. */
public interface ForwardMaintenanceStore {
    Page scan(long enterpriseId,Category category,String after,int limit);
    DeliveryLease claimDelivery(ForwardOperationLocator locator,long target,String owner,Duration duration);
    DeliveryLease renewDelivery(DeliveryLease lease,Duration duration);
    Delivery delivery(DeliveryLease lease,long messageId);
    DeliveryLease markDelivered(DeliveryLease lease,long messageId,Outcome outcome);
    void failTarget(TargetLease lease,String code,boolean retryable);
}
