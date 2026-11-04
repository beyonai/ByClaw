package com.iwhalecloud.byai.manager.infrastructure.cache;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.entity.users.Users;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class SharedUserIdentityTest {
    final String profileKey = "SHARE_BFM_USER_81";
    final String codeKey = "SHARE_BFM_USER_CODE_newadmin";
    final Map<String, String> stored = new ConcurrentHashMap<>();
    final List<String> writes = Collections.synchronizedList(new ArrayList<>());
    Object original;
    ValueOperations<String, String> values;
    Users user;

    @BeforeEach @SuppressWarnings("unchecked") void setup() {
        original = ReflectionTestUtils.getField(RedisUtil.class, "instance");
        StringRedisTemplate template = mock(StringRedisTemplate.class);
        values = mock(ValueOperations.class);
        when(template.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenAnswer(call -> stored.get(call.getArgument(0)));
        when(values.setIfAbsent(anyString(), anyString())).thenAnswer(call -> {
            String key = call.getArgument(0); String value = call.getArgument(1);
            boolean inserted = stored.putIfAbsent(key, value) == null;
            if (inserted) writes.add(key);
            return inserted;
        });
        RedisUtil util = new RedisUtil();
        ReflectionTestUtils.setField(util, "stringRedisTemplate", template);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", util);
        user = new Users(); user.setUserId(81L); user.setUserCode("newadmin");
        user.setUserName("Local new administrator"); user.setState("A"); user.setIsLocked("N");
        user.setPwd("test-password-hash");
    }

    @AfterEach void cleanup() {
        ReflectionTestUtils.setField(RedisUtil.class, "instance", original);
        if (TransactionSynchronizationManager.isSynchronizationActive()) TransactionSynchronizationManager.clearSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(false);
    }

    @Test void publishesProfileBeforeAccountIndexAndDoesNotOverwriteOnRetry() {
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        assertThat(writes).containsExactly(profileKey, codeKey);
        assertThat(stored.get(codeKey)).isEqualTo("81");
        var profile = JSON.parseObject(stored.get(profileKey));
        assertThat(profile.getLong("userId")).isEqualTo(81L);
        assertThat(profile.getString("userCode")).isEqualTo("newadmin");
        assertThat(profile.getLong("comAcctId")).isEqualTo(1L);
        assertThat(profile.getString("sourceSystem")).isEqualTo("byaiManager");
        Map<String, String> before = Map.copyOf(stored);
        user.setUserName("Changed"); user.setPwd("another-test-hash");
        ShareCacheUtil.ensureSharedUserIdentity(user, 9L);
        assertThat(stored).isEqualTo(before);
        assertThat(writes).hasSize(2);
    }

    @Test void preservesPortalAccountMappedToDifferentId() {
        stored.put(codeKey, "42");
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        assertThat(stored).containsOnly(entry(codeKey, "42"));
        verify(values, never()).setIfAbsent(anyString(), anyString());
    }

    @Test void restoresMissingIndexWithoutChangingExistingPortalProfile() {
        String portal = "{\"userId\":81,\"userCode\":\"newadmin\",\"userName\":\"Portal name\",\"comAcctId\":9,\"sourceSystem\":\"DataPortal\"}";
        stored.put(profileKey, portal);
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        assertThat(stored.get(profileKey)).isEqualTo(portal);
        assertThat(stored.get(codeKey)).isEqualTo("81");
        assertThat(writes).containsExactly(codeKey);
    }

    @Test void repairsMissingProfileForMatchingIndex() {
        stored.put(codeKey, "81");
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        assertThat(writes).containsExactly(profileKey);
    }

    @ParameterizedTest @ValueSource(strings = {"broken-json", "null", "{}", "{\"userId\":81,\"userCode\":\"portal-other\"}", "{\"userId\":82,\"userCode\":\"newadmin\"}"})
    void neverReplacesInvalidOrConflictingProfile(String profile) {
        stored.put(profileKey, profile);
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        assertThat(stored).containsOnly(entry(profileKey, profile));
        assertThat(writes).isEmpty();
    }

    @Test void doesNotPublishInvalidInactiveOrLockedAccounts() {
        ShareCacheUtil.ensureSharedUserIdentity(null, 1L);
        ShareCacheUtil.ensureSharedUserIdentity(user, null);
        ShareCacheUtil.ensureSharedUserIdentity(user, 0L);
        user.setState("X"); ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        user.setState("A"); user.setIsLocked("Y"); ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        user.setIsLocked("N"); user.setUserCode(" "); ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        user.setUserCode("newadmin"); user.setUserId(0L); ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        verifyNoInteractions(values);
    }

    @Test void concurrentRepairsOnlyCreateTwoKeys() throws Exception {
        try (ExecutorService pool = Executors.newFixedThreadPool(6)) {
            List<Future<?>> work = new ArrayList<>();
            for (int i = 0; i < 30; i++) work.add(pool.submit(() -> ShareCacheUtil.ensureSharedUserIdentity(user, 1L)));
            for (Future<?> future : work) future.get(5, TimeUnit.SECONDS);
        }
        assertThat(writes).containsExactlyInAnyOrder(profileKey, codeKey);
        assertThat(stored.get(codeKey)).isEqualTo("81");
    }

    @Test void portalProfileWinningRaceIsNeverOverwrittenOrIndexedAsLocal() {
        String portal = "{\"userId\":81,\"userCode\":\"portal-other\"}";
        when(values.setIfAbsent(eq(profileKey), anyString())).thenAnswer(call -> { stored.put(profileKey, portal); return false; });
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        assertThat(stored).containsOnly(entry(profileKey, portal));
    }

    @Test void portalAccountWinningIndexRaceIsNeverOverwritten() {
        when(values.setIfAbsent(eq(codeKey), anyString())).thenAnswer(call -> { stored.put(codeKey, "42"); return false; });
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        assertThat(stored.get(codeKey)).isEqualTo("42");
    }

    void beginTransaction() {
        TransactionSynchronizationManager.setActualTransactionActive(true);
        TransactionSynchronizationManager.initSynchronization();
    }

    @Test void rollbackNeverPublishesAnUncommittedIdentity() {
        beginTransaction();
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        TransactionSynchronizationManager.getSynchronizations().forEach(s -> s.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));
        verifyNoInteractions(values);
    }

    @Test void commitPublishesCapturedIdentity() {
        beginTransaction();
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        user.setUserCode("mutated");
        verifyNoInteractions(values);
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        assertThat(stored.get(codeKey)).isEqualTo("81");
        assertThat(stored).doesNotContainKey("SHARE_BFM_USER_CODE_mutated");
    }

    @Test void failedPostCommitPublicationCanBeRetriedAfterLogin() {
        beginTransaction();
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        when(values.get(codeKey)).thenThrow(new IllegalStateException("Redis temporarily unavailable"));
        assertThatCode(() -> TransactionSynchronizationManager.getSynchronizations()
            .forEach(TransactionSynchronization::afterCommit)).doesNotThrowAnyException();
        assertThat(stored).isEmpty();
        TransactionSynchronizationManager.clearSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(false);
        doAnswer(call -> stored.get(codeKey)).when(values).get(codeKey);
        ShareCacheUtil.ensureSharedUserIdentity(user, 1L);
        assertThat(stored.get(codeKey)).isEqualTo("81");
        assertThat(stored).containsKey(profileKey);
    }

}
