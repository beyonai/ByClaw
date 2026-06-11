package com.iwhalecloud.byai.common.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.util.List;

import org.junit.jupiter.api.Test;

class FileIngressBackendRegistryTest {

    @Test
    void resolvesFileAliasToLocalFileIngressBackend() {
        FileIngressBackend localBackend = mock(FileIngressBackend.class);
        org.mockito.Mockito.when(localBackend.getStorageType()).thenReturn("local");

        FileIngressBackendRegistry registry = new FileIngressBackendRegistry(List.of(localBackend), null);

        assertThat(registry.getBackend("file")).isSameAs(localBackend);
    }
}
