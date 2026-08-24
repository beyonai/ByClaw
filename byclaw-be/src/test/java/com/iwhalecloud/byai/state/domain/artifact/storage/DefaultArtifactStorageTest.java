package com.iwhalecloud.byai.state.domain.artifact.storage;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.storage.AbstractObjectStorageService;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import java.util.List;
import org.junit.jupiter.api.Test;

class DefaultArtifactStorageTest {

    @Test
    void resolvesEveryReadUsingTheStorageTypeRecordedOnTheArtifact() {
        AbstractObjectStorageService<?> local = storage("local");
        AbstractObjectStorageService<?> minio = storage("minio");
        DefaultArtifactStorage storage = new DefaultArtifactStorage(List.of(local, minio));

        storage.exists("local", "/mnt/legacy", "artifacts/legacy/original/a.txt");

        verify(local).exists(StorageLocation.of("artifact", "/mnt/legacy",
            "artifacts/legacy/original/a.txt"));
        verify(minio, never()).exists(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void treatsFileAsTheDeploymentAliasForLocalStorage() {
        AbstractObjectStorageService<?> local = storage("local");
        DefaultArtifactStorage storage = new DefaultArtifactStorage(List.of(local));

        storage.initialize("file", "/mnt/artifacts");

        verify(local).init("/mnt/artifacts");
    }

    private AbstractObjectStorageService<?> storage(String type) {
        AbstractObjectStorageService<?> service = mock(AbstractObjectStorageService.class);
        when(service.getStorageType()).thenReturn(type);
        return service;
    }
}
