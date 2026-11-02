package com.iwhalecloud.byai.state.application.service.dataset;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.client.KnowledgeHttpFailure;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.Data;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.DirOrFile;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbImportResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.lock.TransactionalRedisLockService;
import com.iwhalecloud.byai.common.quota.HacuStoragePolicyReader;
import com.iwhalecloud.byai.manager.domain.operations.EnterpriseStorageService;
import com.iwhalecloud.byai.manager.mapper.operations.EnterpriseStorageMapper;
import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 原产品不受影响、净增量、全企业串行及结果未知保留占用的回归契约。 */
class WorkgroupStorageAdmissionTest {
    private final EnterpriseStorageMapper resources = mock(EnterpriseStorageMapper.class);
    private final HacuStoragePolicyReader policies = mock(HacuStoragePolicyReader.class);
    private final EnterpriseStorageService statistics = mock(EnterpriseStorageService.class);
    private final FeignPythonBuildService knowledge = mock(FeignPythonBuildService.class);
    private final TransactionalRedisLockService locks = mock(TransactionalRedisLockService.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final ValueOperations<String, String> values = mock(ValueOperations.class);
    private final Lock lock = mock(Lock.class);
    private final ObjectMapper json = new ObjectMapper();
    private final AtomicInteger writes = new AtomicInteger();
    private final WorkgroupStorageAdmission admission = new WorkgroupStorageAdmission(resources, policies, statistics, knowledge, locks, redis);
    private Object previousMessages;

    @BeforeEach
    void prepare() throws Exception {
        previousMessages = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messages = new StaticMessageSource();
        messages.setUseCodeAsDefaultMessage(true);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        when(resources.selectCloudEnterprises(11)).thenReturn(List.of(42L));
        when(resources.commerciallyManaged(42)).thenReturn(true);
        when(policies.read(42, true)).thenReturn(1024L);
        when(policies.pendingKey(42)).thenReturn("storage-write:{42}");
        when(locks.obtain(anyString())).thenReturn(lock);
        when(redis.opsForValue()).thenReturn(values);
        when(values.setIfAbsent(anyString(), anyString())).thenReturn(true);
        when(redis.execute(any(DefaultRedisScript.class), anyList(), anyString())).thenReturn(1L);
        when(statistics.usage(42)).thenReturn(json.readTree("{\"groups\":[{\"usedKb\":\"0\",\"fileCount\":0}]}"));
    }

    @AfterEach
    void restoreMessages() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", previousMessages);
    }

    @Test
    void ordinaryByclawResourceNeverUsesHacuPolicyOrStatistics() {
        admission.write(99, "normal", "/f", file(2048), false, false, this::complete);
        assertThat(writes.get()).isEqualTo(1);
        verifyNoInteractions(policies, statistics, locks, redis);
    }

    @Test
    void unboundWorkgroupKeepsOriginalFileBehavior() {
        when(resources.commerciallyManaged(42)).thenReturn(false);
        when(policies.read(42, false)).thenReturn(null);
        admission.write(11, "a", "/f", file(2048), false, false, this::complete);
        assertThat(writes.get()).isEqualTo(1);
        verifyNoInteractions(statistics, locks, redis);
    }

    @Test
    void refusesGrowthBeforeSendingAnyFileAndAllowsExactlyEmptyCapacity() {
        assertThatThrownBy(() -> admission.write(11, "a", "/f", file(1025), false, false, this::complete))
            .isInstanceOf(ResponseStatusException.class);
        assertThat(writes.get()).isZero();
        verify(values, never()).setIfAbsent(anyString(), anyString());
        admission.write(11, "a", "/f", file(1024), false, false, this::complete);
        assertThat(writes.get()).isEqualTo(1);
    }

    @Test
    void zeroLimitAndRoundedUsageDoNotAllowPositiveGrowth() throws Exception {
        when(policies.read(42, true)).thenReturn(0L);
        assertThatThrownBy(() -> admission.write(11, "a", "/f", file(1), false, false, this::complete))
            .isInstanceOf(ResponseStatusException.class);
        when(policies.read(42, true)).thenReturn(1024L);
        // 0.99 KB 可能代表 1018 字节，不能把舍入少报的部分当成剩余空间。
        when(statistics.usage(42)).thenReturn(json.readTree("{\"groups\":[{\"usedKb\":\"0.99\",\"fileCount\":1}]}"));
        assertThatThrownBy(() -> admission.write(11, "a", "/f", file(7), false, false, this::complete))
            .isInstanceOf(ResponseStatusException.class);
        admission.write(11, "a", "/f", file(6), false, false, this::complete);
        assertThat(writes.get()).isEqualTo(1);
    }

    @Test
    void unavailableStatisticsNeverTurnsIntoEmptyCapacity() {
        when(statistics.usage(42)).thenThrow(new IllegalStateException("QA is not deployed"));
        assertThatThrownBy(() -> admission.write(11, "a", "/f", file(1), false, false, this::complete))
            .isInstanceOfSatisfying(ResponseStatusException.class, failure ->
                assertThat(failure.getStatusCode().value()).isEqualTo(503));
        assertThat(writes.get()).isZero();
        verify(values, never()).setIfAbsent(anyString(), anyString());
    }

    @Test
    void replacingWithSmallerFileIsAllowedEvenWhenAlreadyOverQuota() {
        DirOrFile old = new DirOrFile();
        old.setName("/f"); old.setType("file"); old.setSize(2048L);
        Data data = new Data(); data.setData(List.of(old));
        PythonBuildResponse<Data> metadata = new PythonBuildResponse<>();
        metadata.setResultCode("0"); metadata.setResultObject(data);
        when(knowledge.listDir(any(), any())).thenReturn(metadata);
        admission.write(11, "a", "/f", file(1024), false, true, this::complete);
        assertThat(writes.get()).isEqualTo(1);
        verifyNoInteractions(statistics);
    }

    @Test
    void zipUsesExpandedBytesAndRawZipCanStillBeStored() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            zip.putNextEntry(new ZipEntry("large.txt"));
            zip.write(new byte[4096]);
            zip.closeEntry();
        }
        MockMultipartFile zip = new MockMultipartFile("file", "files.zip", "application/zip", output.toByteArray());
        assertThat(zip.getSize()).isLessThan(1024);
        assertThatThrownBy(() -> admission.write(11, "a", "/", zip, null, false, this::complete))
            .isInstanceOf(ResponseStatusException.class);
        assertThat(writes.get()).isZero();
        admission.write(11, "a", "/files.zip", zip, false, false, this::complete);
        assertThat(writes.get()).isEqualTo(1);
    }

    @Test
    void legacyEncodedZipWithLeadingDataCannotHideExpandedSize() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        // Python ZIP 读取中央目录，带前置数据的有效 ZIP 仍可解压。
        output.write(new byte[]{1, 2, 3});
        try (ZipOutputStream zip = new ZipOutputStream(output, Charset.forName("GBK"))) {
            zip.putNextEntry(new ZipEntry("报告.txt"));
            zip.write(new byte[4096]);
            zip.closeEntry();
        }
        MockMultipartFile archive = new MockMultipartFile("file", "files.zip", "application/zip", output.toByteArray());
        assertThatThrownBy(() -> admission.write(11, "a", "/", archive, true, false, this::complete))
            .isInstanceOfSatisfying(ResponseStatusException.class, failure ->
                assertThat(failure.getStatusCode().value()).isEqualTo(409));
        assertThat(writes.get()).isZero();
    }

    @Test
    void explicitWholeRequestRejectionReleasesReservation() {
        PythonBuildResponse<KbImportResult> rejected = new PythonBuildResponse<>();
        rejected.setResultCode("-1");
        assertThat(admission.write(11, "a", "/f", file(1), false, false, () -> rejected)).isSameAs(rejected);
        verify(redis).execute(any(DefaultRedisScript.class), anyList(), anyString());
    }

    @Test
    void unknownOutcomeRetainsReservationButDefiniteRejectionReleasesIt() {
        assertThatThrownBy(() -> admission.write(11, "a", "/f", file(1), false, false,
            () -> { throw new IllegalStateException("timeout"); })).isInstanceOf(IllegalStateException.class);
        verify(redis, never()).execute(any(DefaultRedisScript.class), anyList(), anyString());
        assertThatThrownBy(() -> admission.write(11, "a", "/f", file(1), false, false,
            () -> { throw new KnowledgeHttpFailure(422, "rejected"); })).isInstanceOf(KnowledgeHttpFailure.class);
        verify(redis).execute(any(DefaultRedisScript.class), anyList(), anyString());
    }

    @Test
    void pendingUnknownWriteBlocksRetryAndLostLeaseDoesNotSendFile() {
        when(redis.hasKey("storage-write:{42}")).thenReturn(true);
        assertThatThrownBy(() -> admission.write(11, "a", "/f", file(1), false, false, this::complete))
            .isInstanceOf(ResponseStatusException.class);
        assertThat(writes.get()).isZero();
        verifyNoInteractions(statistics);
        when(redis.hasKey("storage-write:{42}")).thenReturn(false);
        org.mockito.Mockito.doThrow(new IllegalStateException("lost lease")).when(locks).validate(anyString());
        assertThatThrownBy(() -> admission.write(11, "a", "/f", file(1), false, false, this::complete))
            .isInstanceOf(IllegalStateException.class);
        assertThat(writes.get()).isZero();
    }

    @Test
    void twoWorkgroupsCompeteForOneEnterpriseCapacity() throws Exception {
        ReentrantLock shared = new ReentrantLock();
        when(locks.obtain(anyString())).thenAnswer(invocation -> { shared.lock(); return shared; });
        when(resources.selectCloudEnterprises(12)).thenReturn(List.of(42L));
        when(statistics.usage(42)).thenAnswer(invocation -> json.readTree(writes.get() == 0
            ? "{\"groups\":[{\"usedKb\":\"0\",\"fileCount\":0}]}"
            : "{\"groups\":[{\"usedKb\":\"1\",\"fileCount\":1}]}"));
        CountDownLatch start = new CountDownLatch(1);
        CompletableFuture<Boolean> first = CompletableFuture.supplyAsync(() -> compete(11, start));
        CompletableFuture<Boolean> second = CompletableFuture.supplyAsync(() -> compete(12, start));
        start.countDown();
        assertThat(List.of(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS)))
            .containsExactlyInAnyOrder(true, false);
        assertThat(writes.get()).isEqualTo(1);
    }

    private boolean compete(long resource, CountDownLatch start) {
        try {
            start.await();
            admission.write(resource, "a", "/f", file(1024), false, false, this::complete);
            return true;
        } catch (ResponseStatusException full) {
            return false;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }

    private MockMultipartFile file(int size) {
        return new MockMultipartFile("file", "f.txt", "text/plain", new byte[size]);
    }

    private PythonBuildResponse<KbImportResult> complete() {
        writes.incrementAndGet();
        KbImportResult.Item item = new KbImportResult.Item(); item.setSuccess(true);
        KbImportResult body = new KbImportResult(); body.setData(List.of(item));
        PythonBuildResponse<KbImportResult> response = new PythonBuildResponse<>();
        response.setResultCode("0"); response.setResultObject(body);
        return response;
    }
}
