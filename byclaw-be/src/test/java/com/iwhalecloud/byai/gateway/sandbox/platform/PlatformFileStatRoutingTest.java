package com.iwhalecloud.byai.gateway.sandbox.platform;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.*;
import com.iwhalecloud.byai.common.storage.config.*;
import com.iwhalecloud.byai.common.storage.impl.LocalStorageService;
import com.iwhalecloud.byai.common.storage.model.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;

class PlatformFileStatRoutingTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    @TempDir Path root;
    private final PlatformControlClient client = mock(PlatformControlClient.class);
    private final ObjectStorage legacy = mock(ObjectStorage.class);

    private PlatformRoutedStorage remote() {
        var executor = mock(PlatformBackgroundExecution.class);
        var provider = mock(ObjectProvider.class);
        when(provider.getObject()).thenReturn(client);
        var env = new MockEnvironment().withProperty("byclaw.platform.base-url", "http://platform.invalid");
        var gateway = new PlatformRemoteGateway(executor, provider, new ObjectMapper(), env);
        return new PlatformRoutedStorage(legacy, gateway, null, () -> "file");
    }

    private Map<String,Object> target() {
        return Map.of("namespace", "workspace", "bucketOrRoot", "byclaw-alice", "path", "/by/.sessions/123", "shareType", "private");
    }

    @Test void remoteStatUsesOneRpcAndPreservesTheExistingOwnerAddress() {
        var storage = remote();
        when(client.call("storage", "stat", target())).thenReturn(Map.of("code", 0, "data", Map.of("exists", true, "directory", true, "size", 0)));
        assertThat(storage.supportsStat()).isTrue();
        FileStat value = storage.stat(StorageLocation.of("workspace", "byclaw-alice", "/by/.sessions/123", "private"));
        assertThat(value.getExists()).isTrue();assertThat(value.getDirectory()).isTrue();
        verify(client).call("storage", "stat", target());verifyNoMoreInteractions(client);verifyNoInteractions(legacy);
    }

    @Test void remoteMissingStatIsReturnedWithoutAnotherExistsOrListCall() {
        var storage = remote();when(client.call("storage", "stat", target())).thenReturn(Map.of("code", 0, "data", Map.of("exists", false)));
        FileStat value = storage.stat(StorageLocation.of("workspace", "byclaw-alice", "/by/.sessions/123", "private"));
        assertThat(value.getExists()).isFalse();assertThat(value.getDirectory()).isNull();
        verify(client).call("storage", "stat", target());verifyNoMoreInteractions(client);verifyNoInteractions(legacy);
    }

    @Test void remoteErrorsNeverProbeOrExecuteTheLegacyBackend() {
        var storage = remote();RuntimeException failed = new IllegalStateException("remote stat unavailable");
        when(client.call("storage", "stat", target())).thenThrow(failed);
        assertThatThrownBy(() -> storage.stat(StorageLocation.of("workspace", "byclaw-alice", "/by/.sessions/123", "private"))).isSameAs(failed);
        verify(client).call("storage", "stat", target());verifyNoMoreInteractions(client);verifyNoInteractions(legacy);
    }

    @Test void malformedRemoteStatIsNotAFalseMissingResult() {
        var storage = remote();
        for (Map<String,Object> data : List.<Map<String,Object>>of(Map.of(), Map.of("exists", true), Map.of("exists", "false"))) {
            when(client.call("storage", "stat", target())).thenReturn(Map.of("code", 0, "data", data));
            assertThatThrownBy(() -> storage.stat(StorageLocation.of("workspace", "byclaw-alice", "/by/.sessions/123", "private")))
                .isInstanceOf(IllegalStateException.class);
        }
        verifyNoInteractions(legacy);
    }

    @Test void objectStoreConfigurationRetainsItsDeclaredCapabilityWithoutRemoteStat() {
        var executor = mock(PlatformBackgroundExecution.class);
        var provider = mock(ObjectProvider.class);
        var gateway = new PlatformRemoteGateway(executor, provider, new ObjectMapper(), new MockEnvironment().withProperty("byclaw.platform.base-url", "http://platform.invalid"));
        var storage = new PlatformRoutedStorage(legacy, gateway, null, () -> "oss");
        assertThat(storage.supportsStat()).isFalse();verify(legacy).supportsStat();verifyNoInteractions(client, provider);
    }

    @Test void localRouterDelegatesStatToTheConfiguredFilesystemProvider() throws Exception {
        var local = new LocalStorageService();ReflectionTestUtils.setField(local, "basePath", root.toString());
        ReflectionTestUtils.setField(local, "configuredStorageType", "local");
        var properties = new ObjectStorageProperties();properties.setStorageType("file");
        var config = mock(ObjectStorageConfiguration.class);when(config.getStorageConfig()).thenReturn(properties);
        var router = new ObjectStorageRouter(List.of(local));ReflectionTestUtils.setField(router, "objectStorageConfiguration", config);
        Files.createDirectories(root.resolve("byclaw-alice/by/docs"));
        assertThat(router.supportsStat()).isTrue();
        assertThat(router.stat(StorageLocation.of("workspace", "byclaw-alice", "/by/docs")).getDirectory()).isTrue();
    }
}
