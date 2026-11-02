package com.iwhalecloud.byai.common.util;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisClusterConnection;
import org.springframework.data.redis.connection.RedisClusterNode;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class RedisUtilPrefixTest {
    private final StringRedisTemplate template = mock(StringRedisTemplate.class);
    private final RedisConnectionFactory factory = mock(RedisConnectionFactory.class);
    private Object previous;

    @BeforeEach
    void setUp() {
        previous = ReflectionTestUtils.getField(RedisUtil.class, "instance");
        RedisUtil util = new RedisUtil();
        ReflectionTestUtils.setField(util, "stringRedisTemplate", template);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", util);
        when(template.getRequiredConnectionFactory()).thenReturn(factory);
    }

    @AfterEach
    void restore() {
        ReflectionTestUtils.setField(RedisUtil.class, "instance", previous);
    }

    @Test
    void scansAllPrimariesSkipsReplicaAndDeletesIndividualUtf8Keys() {
        RedisClusterConnection cluster = mock(RedisClusterConnection.class);
        when(factory.getConnection()).thenReturn(cluster);
        RedisClusterNode first = mock(RedisClusterNode.class);
        RedisClusterNode second = mock(RedisClusterNode.class);
        RedisClusterNode replica = mock(RedisClusterNode.class);
        when(first.isMaster()).thenReturn(true);
        when(second.isMaster()).thenReturn(true);
        when(cluster.clusterGetNodes()).thenReturn(List.of(first, replica, second));
        Cursor<byte[]> firstCursor = cursor("token:中文");
        Cursor<byte[]> secondCursor = cursor("token:other");
        when(cluster.scan(eq(first), any(ScanOptions.class))).thenReturn(firstCursor);
        when(cluster.scan(eq(second), any(ScanOptions.class))).thenReturn(secondCursor);

        RedisUtil.delByPrefix("token:");

        verify(cluster, never()).scan(eq(replica), any(ScanOptions.class));
        verify(cluster, never()).scan(any(ScanOptions.class));
        verify(template).delete("token:中文");
        verify(template).delete("token:other");
        verify(template, never()).delete(any(java.util.Collection.class));
        verify(firstCursor).close();
        verify(secondCursor).close();
        verify(cluster).close();
    }

    @Test
    void jedisClusterKeepsConnectionAcrossEmptyAndNonEmptyPages() {
        RedisClusterConnection cluster = mock(RedisClusterConnection.class);
        redis.clients.jedis.JedisCluster nativeCluster = mock(redis.clients.jedis.JedisCluster.class);
        redis.clients.jedis.ConnectionPool pool = mock(redis.clients.jedis.ConnectionPool.class);
        redis.clients.jedis.Connection nativeConnection = mock(redis.clients.jedis.Connection.class);
        RedisClusterNode node = mock(RedisClusterNode.class);
        when(node.isMaster()).thenReturn(true);
        when(node.getHost()).thenReturn("127.0.0.1");
        when(node.getPort()).thenReturn(17381);
        when(factory.getConnection()).thenReturn(cluster);
        when(cluster.getNativeConnection()).thenReturn(nativeCluster);
        when(cluster.clusterGetNodes()).thenReturn(List.of(node));
        when(nativeCluster.getClusterNodes()).thenReturn(java.util.Map.of("127.0.0.1:17381", pool));
        when(pool.getResource()).thenReturn(nativeConnection);
        var pages = List.of(
            new redis.clients.jedis.resps.ScanResult<String>("12", List.of()),
            new redis.clients.jedis.resps.ScanResult<String>("24", List.of("token:中文")),
            new redis.clients.jedis.resps.ScanResult<String>("0", List.of("token:last")));
        java.util.concurrent.atomic.AtomicInteger page = new java.util.concurrent.atomic.AtomicInteger();
        when(nativeConnection.executeCommand(any(redis.clients.jedis.CommandObject.class))).thenAnswer(call -> {
            verify(nativeConnection, never()).close();
            return pages.get(page.getAndIncrement());
        });

        RedisUtil.delByPrefix("token:");

        verify(pool).getResource();
        verify(nativeConnection, times(3)).executeCommand(any(redis.clients.jedis.CommandObject.class));
        verify(nativeConnection).close();
        verify(cluster, never()).scan(any(RedisClusterNode.class), any(ScanOptions.class));
        verify(template).delete("token:中文");
        verify(template).delete("token:last");
        verify(cluster).close();
    }

    @Test
    void jedisClusterScanFailureReturnsBorrowedConnection() {
        RedisClusterConnection cluster = mock(RedisClusterConnection.class);
        redis.clients.jedis.JedisCluster nativeCluster = mock(redis.clients.jedis.JedisCluster.class);
        redis.clients.jedis.ConnectionPool pool = mock(redis.clients.jedis.ConnectionPool.class);
        redis.clients.jedis.Connection nativeConnection = mock(redis.clients.jedis.Connection.class);
        RedisClusterNode node = mock(RedisClusterNode.class);
        when(node.isMaster()).thenReturn(true);
        when(node.getHost()).thenReturn("127.0.0.1");
        when(node.getPort()).thenReturn(17381);
        when(factory.getConnection()).thenReturn(cluster);
        when(cluster.getNativeConnection()).thenReturn(nativeCluster);
        when(cluster.clusterGetNodes()).thenReturn(List.of(node));
        when(nativeCluster.getClusterNodes()).thenReturn(java.util.Map.of("127.0.0.1:17381", pool));
        when(pool.getResource()).thenReturn(nativeConnection);
        when(nativeConnection.executeCommand(any(redis.clients.jedis.CommandObject.class)))
            .thenReturn(new redis.clients.jedis.resps.ScanResult<String>("12", List.of("token:first")))
            .thenThrow(new IllegalStateException("second page failed"));

        assertThatThrownBy(() -> RedisUtil.delByPrefix("token:"))
            .hasRootCauseMessage("second page failed");

        verify(nativeConnection).close();
        verify(cluster).close();
        verify(template, never()).delete(any(String.class));
    }

    @Test
    void standaloneAndSentinelUseRegularScan() {
        RedisConnection connection = mock(RedisConnection.class, RETURNS_SELF);
        when(factory.getConnection()).thenReturn(connection);
        Cursor<byte[]> cursor = cursor("token:one");
        when(template.executeWithStickyConnection(any())).thenReturn(cursor);
        RedisUtil.delByPrefix("token:");
        verify(template).delete("token:one");
        verify(cursor).close();
        verify(connection).close();
    }

    @Test
    void scanFailureClosesResourcesAndDoesNotDeletePartialResults() {
        RedisConnection connection = mock(RedisConnection.class, RETURNS_SELF);
        when(factory.getConnection()).thenReturn(connection);
        Cursor<byte[]> cursor = mock(Cursor.class);
        when(template.executeWithStickyConnection(any())).thenReturn(cursor);
        when(cursor.hasNext()).thenThrow(new IllegalStateException("scan failed"));
        assertThatThrownBy(() -> RedisUtil.delByPrefix("token:"))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("prefix=token:");
        verify(cursor).close();
        verify(connection).close();
        verify(template, never()).delete(any(String.class));
    }

    @Test
    void emptyPrefixDoesNotConnect() {
        RedisUtil.delByPrefix("");
        RedisUtil.delByPrefix(null);
        verifyNoInteractions(factory);
    }

    @SuppressWarnings("unchecked")
    private Cursor<byte[]> cursor(String key) {
        Cursor<byte[]> cursor = mock(Cursor.class);
        when(cursor.hasNext()).thenReturn(true, false);
        when(cursor.next()).thenReturn(key.getBytes(StandardCharsets.UTF_8));
        return cursor;
    }
}
