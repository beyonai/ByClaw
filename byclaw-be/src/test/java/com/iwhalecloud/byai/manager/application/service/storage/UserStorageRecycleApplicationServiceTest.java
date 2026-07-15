package com.iwhalecloud.byai.manager.application.service.storage;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.time.Instant;
import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.manager.dto.storage.UserStorageRecycleQuery;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageOperation;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageQuota;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageRecycle;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageGrantMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageOperationMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageQuotaMapper;
import com.iwhalecloud.byai.manager.mapper.storage.UserStorageRecycleMapper;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.mockito.ArgumentCaptor;
import org.apache.ibatis.builder.MapperBuilderAssistant;

class UserStorageRecycleApplicationServiceTest {

    @Test
    void listByUserReturnsRecycleRecords() {
        UserStorageRecycleMapper mapper = mock(UserStorageRecycleMapper.class);
        UserStorageRecycle record = new UserStorageRecycle();
        record.setRecycleId(11L);
        when(mapper.selectList(any())).thenReturn(List.of(record));
        UserStorageRecycleApplicationService service = new UserStorageRecycleApplicationService();
        ReflectionTestUtils.setField(service, "recycleMapper", mapper);

        List<UserStorageRecycle> records = service.listByUser(7L);

        assertThat(records).containsExactly(record);
        verify(mapper).selectList(any());
    }

    @Test
    void archiveForDowngradeMovesOnlineFilesWithoutRevokingRemainingGrantsOrResettingQuota() {
        UserStorageQuotaApplicationService quotaService = mock(UserStorageQuotaApplicationService.class);
        UserStorageQuotaMapper quotaMapper = mock(UserStorageQuotaMapper.class);
        UserStorageRecycleMapper recycleMapper = mock(UserStorageRecycleMapper.class);
        UserStorageOperationMapper operationMapper = mock(UserStorageOperationMapper.class);
        UserStorageGrantMapper grantMapper = mock(UserStorageGrantMapper.class);
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        SequenceService sequenceService = mock(SequenceService.class);
        UserStorageQuota quota = new UserStorageQuota();
        quota.setStorageQuotaId(70L);
        quota.setUserId(7L);
        quota.setBucketName("user-bucket");
        quota.setBaseQuotaBytes(2L * 1024 * 1024 * 1024);
        quota.setAddonQuotaBytes(1024L * 1024 * 1024);
        quota.setTotalQuotaBytes(3L * 1024 * 1024 * 1024);
        quota.setUsedBytes(12L);
        quota.setReservedBytes(0L);
        quota.setUsageStatus(UserStorageQuotaApplicationService.USAGE_EXCEEDED);
        when(quotaService.getRequired(7L)).thenReturn(quota);
        when(quotaService.getRecycleRetentionDays()).thenReturn(7);
        when(sequenceService.nextVal()).thenReturn(11L, 12L);
        when(objectStorage.list(any(), any())).thenReturn(List.of(
            StorageObject.builder().path("by/docs/readme.txt").size(12L).build()));
        UserStorageRecycleApplicationService service = new UserStorageRecycleApplicationService();
        ReflectionTestUtils.setField(service, "quotaService", quotaService);
        ReflectionTestUtils.setField(service, "quotaMapper", quotaMapper);
        ReflectionTestUtils.setField(service, "recycleMapper", recycleMapper);
        ReflectionTestUtils.setField(service, "operationMapper", operationMapper);
        ReflectionTestUtils.setField(service, "grantMapper", grantMapper);
        ReflectionTestUtils.setField(service, "objectStorage", objectStorage);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);

        UserStorageRecycle recycle = service.archiveForDowngrade(7L, "ARCHIVE-PACKAGE-CANCEL-TEST");

        assertThat(recycle.getRecycleStatus()).isEqualTo("AVAILABLE");
        assertThat(recycle.getArchiveBytes()).isEqualTo(12L);
        assertThat(quota.getTotalQuotaBytes()).isEqualTo(3L * 1024 * 1024 * 1024);
        assertThat(quota.getAddonQuotaBytes()).isEqualTo(1024L * 1024 * 1024);
        assertThat(quota.getUsedBytes()).isZero();
        verify(grantMapper, never()).selectList(any());
        verify(grantMapper, never()).updateById(any());
        verify(operationMapper).insert(any(UserStorageOperation.class));
        verify(recycleMapper).insert(any(UserStorageRecycle.class));
        verify(objectStorage).deletePrefix(any());
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void listByUserPageFiltersAndSortsByNewestCreatedTime() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), "test"),
            UserStorageRecycle.class);
        UserStorageRecycleMapper mapper = mock(UserStorageRecycleMapper.class);
        UserStorageRecycle record = new UserStorageRecycle();
        record.setRecycleId(11L);
        when(mapper.selectPage(any(Page.class), any())).thenAnswer(invocation -> {
            Page<UserStorageRecycle> page = invocation.getArgument(0);
            page.setRecords(List.of(record));
            page.setTotal(1);
            return page;
        });
        UserStorageRecycleApplicationService service = new UserStorageRecycleApplicationService();
        ReflectionTestUtils.setField(service, "recycleMapper", mapper);
        UserStorageRecycleQuery query = new UserStorageRecycleQuery();
        query.setUserId(7L);
        query.setPageNum(2);
        query.setPageSize(500);
        query.setRecycleStatus(" available ");
        query.setCreatedStart(date("2026-07-14T09:00:00Z"));
        query.setCreatedEnd(date("2026-07-14T10:00:00Z"));
        query.setExpiredStart(date("2026-07-21T09:00:00Z"));
        query.setExpiredEnd(date("2026-07-21T10:00:00Z"));

        Page<UserStorageRecycle> result = service.listByUserPage(query);

        assertThat(result.getRecords()).containsExactly(record);
        assertThat(query.getRecycleStatus()).isEqualTo("AVAILABLE");
        ArgumentCaptor<Page> pageCaptor = ArgumentCaptor.forClass(Page.class);
        ArgumentCaptor<Wrapper> wrapperCaptor = ArgumentCaptor.forClass(Wrapper.class);
        verify(mapper).selectPage(pageCaptor.capture(), wrapperCaptor.capture());
        assertThat(pageCaptor.getValue().getCurrent()).isEqualTo(2);
        assertThat(pageCaptor.getValue().getSize()).isEqualTo(200);
        assertThat(wrapperCaptor.getValue().getSqlSegment())
            .contains("recycle_status")
            .contains("started_time")
            .contains("retention_until")
            .contains("ORDER BY started_time DESC,recycle_id DESC");
    }

    @Test
    void listByUserPageRejectsInvalidStatusAndTimeRanges() {
        UserStorageRecycleApplicationService service = new UserStorageRecycleApplicationService();
        UserStorageRecycleQuery invalidStatus = new UserStorageRecycleQuery();
        invalidStatus.setUserId(7L);
        invalidStatus.setRecycleStatus("UNKNOWN");

        assertThatThrownBy(() -> service.listByUserPage(invalidStatus))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("回收站状态");

        UserStorageRecycleQuery invalidRange = new UserStorageRecycleQuery();
        invalidRange.setUserId(7L);
        invalidRange.setCreatedStart(date("2026-07-14T11:00:00Z"));
        invalidRange.setCreatedEnd(date("2026-07-14T10:00:00Z"));

        assertThatThrownBy(() -> service.listByUserPage(invalidRange))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("创建时间");
    }

    @Test
    void listByUserPageRejectsMissingUserId() {
        UserStorageRecycleApplicationService service = new UserStorageRecycleApplicationService();

        assertThatThrownBy(() -> service.listByUserPage(new UserStorageRecycleQuery()))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("用户标识");
    }

    @Test
    void listByUserRejectsMissingUserId() {
        UserStorageRecycleApplicationService service = new UserStorageRecycleApplicationService();

        assertThatThrownBy(() -> service.listByUser(null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("用户标识");
    }

    @Test
    void listPreviewFilesMapsArchiveChildrenToFileBrowserItems() {
        UserStorageRecycleMapper mapper = mock(UserStorageRecycleMapper.class);
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        when(mapper.selectById(11L)).thenReturn(availableRecycle());
        when(objectStorage.list(any(), any())).thenReturn(List.of(
            StorageObject.builder().path("request-1/by/docs/").isDir(true)
                .lastModified("2026-07-14T10:00:00Z").build(),
            StorageObject.builder().path("request-1/by/readme.txt").size(12L)
                .lastModified("2026-07-14T10:01:00Z").build()));
        UserStorageRecycleApplicationService service = service(mapper, objectStorage);

        List<FileBrowserItemVo> items = service.listPreviewFiles(7L, 11L, "/");

        assertThat(items).hasSize(2);
        assertThat(items.get(0).getName()).isEqualTo("docs");
        assertThat(items.get(0).getPath()).isEqualTo("/docs/");
        assertThat(items.get(0).isDir()).isTrue();
        assertThat(items.get(1).getName()).isEqualTo("readme.txt");
        assertThat(items.get(1).getPath()).isEqualTo("/readme.txt");
        assertThat(items.get(1).getSize()).isEqualTo(12L);

        ArgumentCaptor<StoragePrefix> prefixCaptor = ArgumentCaptor.forClass(StoragePrefix.class);
        verify(objectStorage).list(prefixCaptor.capture(), any());
        assertThat(prefixCaptor.getValue().getBucketOrRoot()).isEqualTo("user-bucket-recycle");
        assertThat(prefixCaptor.getValue().getPrefix()).isEqualTo("request-1/by/");
        assertThat(prefixCaptor.getValue().isRecursive()).isFalse();
    }

    @Test
    void listPreviewFilesUsesSelectedDirectoryAndIgnoresObjectsOutsideArchiveRoot() {
        UserStorageRecycleMapper mapper = mock(UserStorageRecycleMapper.class);
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        when(mapper.selectById(11L)).thenReturn(availableRecycle());
        when(objectStorage.list(any(), any())).thenReturn(List.of(
            StorageObject.builder().path("request-1/by/docs/guide.pdf").size(20L).build(),
            StorageObject.builder().path("other-user/by/secret.txt").size(99L).build()));
        UserStorageRecycleApplicationService service = service(mapper, objectStorage);

        List<FileBrowserItemVo> items = service.listPreviewFiles(7L, 11L, "/docs/");

        assertThat(items).extracting(FileBrowserItemVo::getPath).containsExactly("/docs/guide.pdf");
        ArgumentCaptor<StoragePrefix> prefixCaptor = ArgumentCaptor.forClass(StoragePrefix.class);
        verify(objectStorage).list(prefixCaptor.capture(), any());
        assertThat(prefixCaptor.getValue().getPrefix()).isEqualTo("request-1/by/docs/");
    }

    @Test
    void downloadPreviewFileReadsOnlyFileInsideSelectedRecycle() {
        UserStorageRecycleMapper mapper = mock(UserStorageRecycleMapper.class);
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        when(mapper.selectById(11L)).thenReturn(availableRecycle());
        when(objectStorage.exists(any())).thenReturn(true);
        InputStream expected = new ByteArrayInputStream("preview".getBytes());
        when(objectStorage.get(any())).thenReturn(expected);
        UserStorageRecycleApplicationService service = service(mapper, objectStorage);

        InputStream actual = service.downloadPreviewFile(7L, 11L, "/docs/guide.pdf");

        assertThat(actual).isSameAs(expected);
        ArgumentCaptor<StorageLocation> locationCaptor = ArgumentCaptor.forClass(StorageLocation.class);
        verify(objectStorage).get(locationCaptor.capture());
        assertThat(locationCaptor.getValue().getBucketOrRoot()).isEqualTo("user-bucket-recycle");
        assertThat(locationCaptor.getValue().getPath()).isEqualTo("/request-1/by/docs/guide.pdf");
    }

    @Test
    void previewRejectsWrongOwnerUnavailableRecordAndMissingFile() {
        UserStorageRecycleMapper mapper = mock(UserStorageRecycleMapper.class);
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        UserStorageRecycle recycle = availableRecycle();
        when(mapper.selectById(11L)).thenReturn(recycle);
        UserStorageRecycleApplicationService service = service(mapper, objectStorage);

        assertThatThrownBy(() -> service.listPreviewFiles(8L, 11L, "/"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("可预览");

        recycle.setRecycleStatus("RESTORED");
        assertThatThrownBy(() -> service.listPreviewFiles(7L, 11L, "/"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("可预览");

        recycle.setRecycleStatus("AVAILABLE");
        when(objectStorage.exists(any())).thenReturn(false);
        assertThatThrownBy(() -> service.downloadPreviewFile(7L, 11L, "/missing.txt"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("不存在");
        verify(objectStorage, never()).get(any());
    }

    @Test
    void previewRejectsTraversalAndInvalidArchivePath() {
        UserStorageRecycleMapper mapper = mock(UserStorageRecycleMapper.class);
        ObjectStorage objectStorage = mock(ObjectStorage.class);
        UserStorageRecycle recycle = availableRecycle();
        when(mapper.selectById(11L)).thenReturn(recycle);
        UserStorageRecycleApplicationService service = service(mapper, objectStorage);

        assertThatThrownBy(() -> service.listPreviewFiles(7L, 11L, "/../secret/"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("路径无效");
        assertThatThrownBy(() -> service.downloadPreviewFile(7L, 11L, "\\..\\secret.txt"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("路径无效");

        recycle.setArchivePath("../other-user");
        assertThatThrownBy(() -> service.listPreviewFiles(7L, 11L, "/"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("归档路径无效");
        verify(objectStorage, never()).list(any(), any());
    }

    private UserStorageRecycleApplicationService service(UserStorageRecycleMapper mapper, ObjectStorage objectStorage) {
        UserStorageRecycleApplicationService service = new UserStorageRecycleApplicationService();
        ReflectionTestUtils.setField(service, "recycleMapper", mapper);
        ReflectionTestUtils.setField(service, "objectStorage", objectStorage);
        return service;
    }

    private UserStorageRecycle availableRecycle() {
        UserStorageRecycle recycle = new UserStorageRecycle();
        recycle.setRecycleId(11L);
        recycle.setUserId(7L);
        recycle.setArchiveBucket("user-bucket-recycle");
        recycle.setArchivePath("request-1");
        recycle.setRecycleStatus("AVAILABLE");
        return recycle;
    }

    private static Date date(String value) {
        return Date.from(Instant.parse(value));
    }
}
