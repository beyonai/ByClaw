package com.iwhalecloud.byai.state.domain.groupchat.forward.attachment;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
/** Per-operation cancellation closes registered streams even when their reader is blocked. */
public final class ForwardStreamCancellation implements AutoCloseable {
    private final Set<AutoCloseable> resources=ConcurrentHashMap.newKeySet();
    private final AtomicBoolean closed=new AtomicBoolean();
    public <T extends AutoCloseable>T track(T resource){resources.add(resource);if(closed.get()){closeResource(resource);throw new IllegalStateException("FORWARD_LEASE_LOST");}return resource;}
    public void check(){if(closed.get()||Thread.currentThread().isInterrupted())throw new IllegalStateException("FORWARD_LEASE_LOST");}
    public void forget(AutoCloseable resource){resources.remove(resource);}
    @Override public void close(){closed.set(true);for(var resource:resources)closeResource(resource);resources.clear();}
    private void closeResource(AutoCloseable resource){try{resource.close();}catch(Exception ignored){/* Cancellation never exposes transport details. */}}
}
