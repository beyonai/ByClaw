package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisCluster;

class WorkerLeaseTtlSupportTest {
    final String key="byai_gateway:v2:registry:worker:{dynamic-worker}:online";

    @Test void standaloneReadReturnsBorrowedConnection() {
        Jedis borrowed=mock(Jedis.class);
        when(borrowed.ttl(key)).thenReturn(29L);
        assertEquals(29L,WorkerLeaseTtlSupport.read(borrowed,key,true));
        verify(borrowed).ttl(key); verify(borrowed).close();
    }
    @Test void standaloneReadFailureStillReturnsConnection() {
        Jedis borrowed=mock(Jedis.class);
        IllegalStateException failure=new IllegalStateException("ttl unavailable");
        when(borrowed.ttl(key)).thenThrow(failure);
        assertSame(failure,assertThrows(IllegalStateException.class,()->WorkerLeaseTtlSupport.read(borrowed,key,true)));
        verify(borrowed).close();
    }
    @Test void closeFailureDoesNotHideTheOriginalReadFailure() {
        Jedis borrowed=mock(Jedis.class);
        IllegalStateException failure=new IllegalStateException("ttl unavailable");
        when(borrowed.ttl(key)).thenThrow(failure);
        doThrow(new IllegalArgumentException("close unavailable")).when(borrowed).close();
        Throwable actual=assertThrows(IllegalStateException.class,()->WorkerLeaseTtlSupport.read(borrowed,key,true));
        assertSame(failure,actual); assertEquals(1,actual.getSuppressed().length);
    }
    @Test void clusterReadNeverClosesSharedClient() throws Exception {
        JedisCluster shared=mock(JedisCluster.class);
        when(shared.ttl(key)).thenReturn(23L);
        assertEquals(23L,WorkerLeaseTtlSupport.read(shared,key,true));
        verify(shared,never()).close();
    }
    @Test void clusterReadFailureNeverClosesSharedClient() throws Exception {
        JedisCluster shared=mock(JedisCluster.class);
        when(shared.ttl(key)).thenThrow(new IllegalStateException("ttl unavailable"));
        assertThrows(IllegalStateException.class,()->WorkerLeaseTtlSupport.read(shared,key,true));
        verify(shared,never()).close();
    }
    @Test void missingLeaseShowsZeroOnlyWhenWorkerIsKnownOffline() throws Exception {
        JedisCluster shared=mock(JedisCluster.class);
        when(shared.ttl(key)).thenReturn(-2L);
        assertEquals(0L,WorkerLeaseTtlSupport.read(shared,key,false));
        assertNull(WorkerLeaseTtlSupport.read(shared,key,true));
        assertNull(WorkerLeaseTtlSupport.read(shared,key,null));
        verify(shared,never()).close();
    }
    @Test void persistentLeaseDoesNotInventExpirationAndZeroIsPreserved() {
        Jedis borrowed=mock(Jedis.class);
        when(borrowed.ttl(key)).thenReturn(-1L);
        assertNull(WorkerLeaseTtlSupport.read(borrowed,key,true));
        verify(borrowed).close();
        Jedis another=mock(Jedis.class);when(another.ttl(key)).thenReturn(0L);
        assertEquals(0L,WorkerLeaseTtlSupport.read(another,key,true));verify(another).close();
    }
}
