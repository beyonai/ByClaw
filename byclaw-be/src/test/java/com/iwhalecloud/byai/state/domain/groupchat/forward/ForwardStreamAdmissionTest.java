package com.iwhalecloud.byai.state.domain.groupchat.forward;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.ForwardStreamAdmission;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.ForwardStreamCancellation;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.*;
class ForwardStreamAdmissionTest {
    @Test void independentInstancesShareFourSlotsAndDoNotReleaseAnotherOwner(){
        var keys=new HashMap<String,String>();try(var redis=mockStatic(RedisUtil.class)){
            redis.when(()->RedisUtil.setnx(anyString(),anyString())).thenAnswer(i->keys.putIfAbsent(i.getArgument(0),i.getArgument(1))==null);
            redis.when(()->RedisUtil.getString(anyString())).thenAnswer(i->keys.get(i.getArgument(0)));
            redis.when(()->RedisUtil.lock(anyString(),anyString(),anyLong())).thenAnswer(i->keys.putIfAbsent(i.getArgument(0),i.getArgument(1))==null);
            redis.when(()->RedisUtil.renewLock(anyString(),anyString(),anyLong())).thenAnswer(i->java.util.Objects.equals(keys.get(i.getArgument(0)),i.getArgument(1)));
            redis.when(()->RedisUtil.releaseLock(anyString(),anyString())).thenAnswer(i->keys.remove(i.getArgument(0),i.getArgument(1)));
            var first=new ForwardStreamAdmission(new GroupChatForwardProperties());var second=new ForwardStreamAdmission(new GroupChatForwardProperties());
            List<ForwardStreamAdmission.Permit> permits=new ArrayList<>();try{
                for(int n=0;n<4;n++)permits.add((n%2==0?first:second).acquire(new ForwardStreamCancellation()));
                assertThatThrownBy(()->second.acquire(new ForwardStreamCancellation())).hasMessage("FORWARD_ADMISSION_BUSY");
                permits.forEach(ForwardStreamAdmission.Permit::verifyOwned);
                var slot=keys.keySet().stream().filter(k->k.contains("slot:")).findFirst().orElseThrow();keys.put(slot,"replacement");int lost=0;for(var permit:permits){try{permit.verifyOwned();}catch(IllegalStateException expected){lost++;}}assertThat(lost).isOne();permits.forEach(ForwardStreamAdmission.Permit::close);assertThat(keys.get(slot)).isEqualTo("replacement");
                keys.put("byai:group-forward:stream:capacity","5");assertThatThrownBy(()->first.acquire(new ForwardStreamCancellation())).hasMessage("FORWARD_ADMISSION_UNAVAILABLE");
            }finally{permits.forEach(ForwardStreamAdmission.Permit::close);first.close();second.close();}
        }
    }
    @Test void invalidRecoveryConfigurationFailsAtStartup(){var properties=new GroupChatForwardProperties();properties.setWorkerRenewSeconds(60);assertThatThrownBy(properties::validateRecovery).hasMessage("FORWARD_INVALID_CONFIGURATION");}
    @Test void completedPermitCannotCancelSharedScopeFromInflightHeartbeat() throws Exception {
        var keys=new java.util.concurrent.ConcurrentHashMap<String,String>();
        var callbacks=new java.util.ArrayList<Runnable>();
        var scheduler=mock(java.util.concurrent.ScheduledExecutorService.class);
        when(scheduler.scheduleAtFixedRate(any(Runnable.class),anyLong(),anyLong(),any()))
            .thenAnswer(invocation->{callbacks.add(invocation.getArgument(0));return mock(java.util.concurrent.ScheduledFuture.class);});
        var admission=new ForwardStreamAdmission(new GroupChatForwardProperties());
        org.springframework.test.util.ReflectionTestUtils.setField(admission,"renewal",scheduler);
        var entered=new java.util.concurrent.CountDownLatch(1);
        var resume=new java.util.concurrent.CountDownLatch(1);
        var shared=new ForwardStreamCancellation();
        var streamClosed=new java.util.concurrent.atomic.AtomicBoolean();
        shared.track((AutoCloseable)()->streamClosed.set(true));
        try(var redis=mockStatic(RedisUtil.class);var worker=java.util.concurrent.Executors.newSingleThreadExecutor()) {
            redis.when(()->RedisUtil.setnx(anyString(),anyString())).thenAnswer(invocation->keys.putIfAbsent(invocation.getArgument(0),invocation.getArgument(1))==null);
            redis.when(()->RedisUtil.getString(anyString())).thenAnswer(invocation->keys.get(invocation.getArgument(0)));
            redis.when(()->RedisUtil.lock(anyString(),anyString(),anyLong())).thenAnswer(invocation->keys.putIfAbsent(invocation.getArgument(0),invocation.getArgument(1))==null);
            redis.when(()->RedisUtil.releaseLock(anyString(),anyString())).thenAnswer(invocation->keys.remove(invocation.getArgument(0),invocation.getArgument(1)));
            try(var finished=admission.acquire(shared);var active=admission.acquire(shared)) {
                var heartbeat=worker.submit(()->{
                    try(var callbackRedis=mockStatic(RedisUtil.class)) {
                        callbackRedis.when(()->RedisUtil.renewLock(anyString(),anyString(),anyLong())).thenAnswer(invocation->{
                            entered.countDown();assertThat(resume.await(2,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                            return Objects.equals(keys.get(invocation.getArgument(0)),invocation.getArgument(1));
                        });
                        callbacks.getFirst().run();
                    }
                });
                assertThat(entered.await(2,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                finished.close();
                assertThat(keys.keySet().stream().filter(key->key.contains("slot:")).count()).isEqualTo(1);
                resume.countDown();heartbeat.get(2,java.util.concurrent.TimeUnit.SECONDS);
                assertThat(streamClosed).isFalse();assertThatCode(active::check).doesNotThrowAnyException();
                // An active permit still cancels the shared source scope on real token loss.
                redis.when(()->RedisUtil.renewLock(anyString(),anyString(),anyLong())).thenReturn(false);
                callbacks.get(1).run();assertThat(streamClosed).isTrue();
                assertThatThrownBy(active::check).hasMessage("FORWARD_LEASE_LOST");
            } finally {resume.countDown();admission.close();}
        }
    }

}
