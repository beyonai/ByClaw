package com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.ForwardStreamCancellation;
import org.springframework.stereotype.Component;
import java.util.UUID;
import java.util.concurrent.*;
/** Deployment-wide leased admissions use existing single-key Redis token CAS; lease loss does not prove remote I/O stopped. */
@Component
public class ForwardStreamAdmission {
    private static final String PREFIX="byai:group-forward:stream:";
    private final GroupChatForwardProperties properties;
    private final ScheduledExecutorService renewal=Executors.newScheduledThreadPool(1,r->{var t=new Thread(r,"forward-stream-renew");t.setDaemon(true);return t;});
    public ForwardStreamAdmission(GroupChatForwardProperties properties){this.properties=properties;}
    @jakarta.annotation.PreDestroy public void close(){renewal.shutdownNow();}
    public Permit acquire(ForwardStreamCancellation cancellation){
        properties.validateRecovery();String capacity=Integer.toString(properties.getGlobalStreams());
        // A persistent capacity guard rejects mixed replica configurations; changes require coordinated draining.
        RedisUtil.setnx(PREFIX+"capacity",capacity);
        if(!capacity.equals(RedisUtil.getString(PREFIX+"capacity")))throw new IllegalStateException("FORWARD_ADMISSION_UNAVAILABLE");
        String token=UUID.randomUUID().toString();int first=ThreadLocalRandom.current().nextInt(properties.getGlobalStreams());
        for(int i=0;i<properties.getGlobalStreams();i++){
            String key=PREFIX+"slot:"+((first+i)%properties.getGlobalStreams());
            if(Boolean.TRUE.equals(RedisUtil.lock(key,token,properties.getWorkerLeaseSeconds())))return new Permit(key,token,cancellation);
        }
        throw new IllegalStateException("FORWARD_ADMISSION_BUSY");
    }
    public final class Permit implements AutoCloseable {
        private enum State { ACTIVE, CLOSED, LOST }
        private final String key;
        private final String token;
        private final ForwardStreamCancellation cancellation;
        private final ScheduledFuture<?> heartbeat;
        private final java.util.concurrent.atomic.AtomicReference<State> state =
            new java.util.concurrent.atomic.AtomicReference<>(State.ACTIVE);

        Permit(String key, String token, ForwardStreamCancellation cancellation) {
            this.key = key;
            this.token = token;
            this.cancellation = cancellation;
            heartbeat = renewal.scheduleAtFixedRate(this::renewHeartbeat,
                properties.getWorkerRenewSeconds(), properties.getWorkerRenewSeconds(), TimeUnit.SECONDS);
        }

        private void renewHeartbeat() {
            if (state.get() != State.ACTIVE) return;
            try {
                if (!Boolean.TRUE.equals(RedisUtil.renewLock(key, token, properties.getWorkerLeaseSeconds()))) lose();
            } catch (RuntimeException error) {
                lose();
            }
        }

        private void lose() {
            // Closing normally wins against a late renewal result without cancelling sibling streams.
            if (state.compareAndSet(State.ACTIVE, State.LOST)) cancellation.close();
        }

        public void check() {
            cancellation.check();
            if (state.get() != State.ACTIVE) throw new IllegalStateException("FORWARD_ADMISSION_UNAVAILABLE");
        }

        /** Recheck the distributed token at publication boundaries even if the heartbeat thread was delayed. */
        public void verifyOwned() {
            check();
            try {
                if (!Boolean.TRUE.equals(RedisUtil.renewLock(key, token, properties.getWorkerLeaseSeconds()))) lose();
            } catch (RuntimeException failure) {
                lose();
            }
            check();
        }

        @Override public void close() {
            if (state.getAndSet(State.CLOSED) == State.CLOSED) return;
            heartbeat.cancel(false);
            try {
                RedisUtil.releaseLock(key, token);
            } catch (RuntimeException ignored) {
                // Unknown release is bounded by TTL; it never releases a different owner.
            }
        }
    }
}
