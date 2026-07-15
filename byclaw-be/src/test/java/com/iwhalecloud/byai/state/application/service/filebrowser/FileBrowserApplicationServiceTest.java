package com.iwhalecloud.byai.state.application.service.filebrowser;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.exception.StorageQuotaExceededException;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageQuotaApplicationService;
import com.iwhalecloud.byai.manager.entity.storage.UserStorageQuota;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

@ExtendWith(MockitoExtension.class)
class FileBrowserApplicationServiceTest {

    @Mock
    private FileBrowserProviderFactory providerFactory;

    @Mock
    private FileBrowserProvider provider;

    @Mock
    private ByClawSkillResourceApplicationService skillResourceService;

    @Mock
    private UserStorageQuotaApplicationService quotaService;

    private FileBrowserApplicationService service;

    @BeforeEach
    void setUp() {
        UserStorageQuota quota = new UserStorageQuota();
        quota.setUserId(7L);
        when(quotaService.ensureQuotaByUserCode("user001")).thenReturn(quota);
        when(providerFactory.getProvider()).thenReturn(provider);
        service = new FileBrowserApplicationService(providerFactory, skillResourceService, quotaService);
    }

    @Test
    void uploadReservesWholeBatchBeforeCommittingEachPersistedFile() throws Exception {
        MockMultipartFile first = new MockMultipartFile("files", "quota.txt", "text/plain", "quota".getBytes());
        MockMultipartFile second = new MockMultipartFile("files", "more.txt", "text/plain", "more".getBytes());
        long totalBytes = first.getSize() + second.getSize();

        service.upload("user001", 11L, "/workspace/", new MultipartFile[] {first, second});

        verify(quotaService).reserveWrite(7L, totalBytes);
        verify(provider, org.mockito.Mockito.times(2))
            .upload(eq("user001"), eq(11L), eq("/workspace/"), any(MultipartFile[].class));
        verify(quotaService).commitWrite(7L, first.getSize());
        verify(quotaService).commitWrite(7L, second.getSize());
        verify(quotaService, never()).releaseWrite(any(), anyLong());
        verify(skillResourceService).registerFileManagedSkills("user001", 11L, "/workspace/", java.util.List.of(first));
        verify(skillResourceService).registerFileManagedSkills("user001", 11L, "/workspace/", java.util.List.of(second));
    }

    @Test
    void providerFailureReleasesReservation() throws Exception {
        MockMultipartFile file = new MockMultipartFile("files", "quota.txt", "text/plain", "quota".getBytes());
        doThrow(new IllegalStateException("sandbox unavailable")).when(provider)
            .upload(eq("user001"), eq(11L), eq("/workspace/"), any(MultipartFile[].class));

        assertThatThrownBy(() -> service.upload("user001", 11L, "/workspace/", new MultipartFile[] {file}))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("sandbox unavailable");

        verify(quotaService).releaseWrite(7L, file.getSize());
        verify(quotaService, never()).commitWrite(any(), anyLong());
        verify(skillResourceService, never()).registerFileManagedSkills(any(), any(), any(), any());
    }

    @Test
    void quotaRejectionStopsUploadBeforeProviderCall() throws Exception {
        MockMultipartFile file = new MockMultipartFile("files", "quota.txt", "text/plain", "quota".getBytes());
        doThrow(new StorageQuotaExceededException("quota exceeded")).when(quotaService)
            .reserveWrite(7L, file.getSize());

        assertThatThrownBy(() -> service.upload("user001", 11L, "/workspace/", new MultipartFile[] {file}))
            .isInstanceOf(StorageQuotaExceededException.class);

        verify(provider, never()).upload(any(), any(), any(), any());
        verify(quotaService, never()).commitWrite(any(), anyLong());
        verify(quotaService, never()).releaseWrite(any(), anyLong());
    }

    @Test
    void deleteFileMeasuresBeforeDeleteAndSubtractsQuotaAfterSuccess() {
        when(provider.list("user001", 11L, "/workspace/"))
            .thenReturn(List.of(item("quota.txt", "/workspace/quota.txt", false, 128L)));

        service.delete("user001", 11L, List.of("/workspace/quota.txt"));

        verify(provider).delete("user001", 11L, List.of("/workspace/quota.txt"));
        verify(quotaService).commitDelete(7L, 128L);
    }

    @Test
    void deleteDirectoryRecursivelyMeasuresFilesWithoutDoubleCountingOverlappingPaths() {
        when(provider.list("user001", 11L, "/workspace/docs/"))
            .thenReturn(List.of(
                item("readme.md", "/workspace/docs/readme.md", false, 80L),
                item("nested", "/workspace/docs/nested/", true, 0L)));
        when(provider.list("user001", 11L, "/workspace/docs/nested/"))
            .thenReturn(List.of(item("data.json", "/workspace/docs/nested/data.json", false, 48L)));

        service.delete("user001", 11L,
            List.of("/workspace/docs/", "/workspace/docs/nested/data.json"));

        verify(provider).delete("user001", 11L,
            List.of("/workspace/docs/", "/workspace/docs/nested/data.json"));
        verify(quotaService).commitDelete(7L, 128L);
    }

    @Test
    void deleteFailureDoesNotSubtractQuota() {
        when(provider.list("user001", 11L, "/workspace/"))
            .thenReturn(List.of(item("quota.txt", "/workspace/quota.txt", false, 128L)));
        doThrow(new IllegalStateException("storage unavailable")).when(provider)
            .delete("user001", 11L, List.of("/workspace/quota.txt"));

        assertThatThrownBy(() -> service.delete("user001", 11L, List.of("/workspace/quota.txt")))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("storage unavailable");

        verify(quotaService, never()).commitDelete(any(), anyLong());
    }

    private FileBrowserItemVo item(String name, String path, boolean directory, long size) {
        FileBrowserItemVo item = new FileBrowserItemVo();
        item.setName(name);
        item.setPath(path);
        item.setDir(directory);
        item.setSize(size);
        return item;
    }
}
