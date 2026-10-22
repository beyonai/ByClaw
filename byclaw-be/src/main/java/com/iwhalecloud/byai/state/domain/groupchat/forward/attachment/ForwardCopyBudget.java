package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;

import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import java.util.*;
import java.util.concurrent.Semaphore;

/** One per request, shared across all target handles; durable association/proof sizes seed it on recovery. */
public final class ForwardCopyBudget {
    private final long fileLimit, targetLimit, requestLimit;
    private final int attachmentLimit;
    private final Semaphore slots;
    private final Map<List<String>,Long> reservations=new HashMap<>();
    private final Map<Long,Long> targets=new HashMap<>();
    private final Map<Long,Integer> counts=new HashMap<>();
    private long total;
    private Long requestId;
    public ForwardCopyBudget(GroupChatForwardProperties properties) {
        fileLimit=properties.effectiveMaxFileBytes(); targetLimit=Math.min(properties.getMaxTargetBytes(),2147483648L);
        requestLimit=Math.min(properties.getMaxRequestBytes(),10737418240L);
        attachmentLimit=Math.min(properties.getMaxAttachmentsPerTarget(),100);
        slots=new Semaphore(Math.max(1,Math.min(properties.getParallelFiles(),2)),true);
    }
    public synchronized void reserve(long request,long target,String item,String attachment,long size) {
        if(requestId!=null && requestId!=request) throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        if(size<0 || size>fileLimit) throw new IllegalArgumentException("FORWARD_FILE_TOO_LARGE");
        var key=List.of(Long.toString(target),item,attachment);
        Long existing=reservations.get(key);
        if(existing!=null) {if(existing!=size) throw new IllegalArgumentException("FORWARD_SOURCE_CHANGED");return;}
        long targetSize=targets.getOrDefault(target,0L);
        if(size>targetLimit-targetSize) throw new IllegalArgumentException("FORWARD_TARGET_TOO_LARGE");
        if(size>requestLimit-total) throw new IllegalArgumentException("FORWARD_REQUEST_TOO_LARGE");
        int count=counts.getOrDefault(target,0);
        if(count>=attachmentLimit) throw new IllegalArgumentException("FORWARD_TOO_MANY_ATTACHMENTS");
        requestId=request;reservations.put(key,size);targets.put(target,targetSize+size);counts.put(target,count+1);total+=size;
    }
    public AutoCloseable enter() {
        try {slots.acquire();} catch(InterruptedException error) {Thread.currentThread().interrupt();throw new IllegalStateException("FORWARD_COPY_INTERRUPTED",error);}
        return slots::release;
    }
}
