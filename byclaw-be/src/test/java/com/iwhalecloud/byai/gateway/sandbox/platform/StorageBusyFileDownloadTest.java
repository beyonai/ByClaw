package com.iwhalecloud.byai.gateway.sandbox.platform;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFilePathResolver;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFileStorage;
import feign.Request;
import feign.Response;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class StorageBusyFileDownloadTest {
    private final PlatformStorageClient transport = mock(PlatformStorageClient.class);
    private final ObjectStorage legacy = mock(ObjectStorage.class);

    @Test void busyPrimaryReadRetainsIts503WithoutTryingOtherPathsOrLegacyStorage() {
        when(transport.get(anyMap())).thenReturn(response(503,
            "{\"code\":-1,\"data\":{\"errorType\":\"STORAGE_BUSY\"}}"));
        FilesApplicationService files = new FilesApplicationService();
        ReflectionTestUtils.setField(files, "commonFileStorage", new CommonFileStorage(storage()));
        ReflectionTestUtils.setField(files, "commonFilePathResolver", new CommonFilePathResolver());

        assertThatThrownBy(() -> files.openCommonFileInputStream("byclaw-owner", "/.sessions/123/file.png"))
            .isInstanceOfSatisfying(ResponseStatusException.class, failure -> {
                assertThat(failure.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                assertThat(failure.getReason()).isEqualTo("STORAGE_BUSY");
            });
        verify(transport, times(1)).get(anyMap());
        verifyNoInteractions(legacy);
    }

    @Test void another503IsNotMisreportedAsStorageLockContention() {
        when(transport.get(anyMap())).thenReturn(response(503,
            "{\"data\":{\"errorType\":\"OTHER_PROVIDER_FAILURE\"}}"));
        assertThatThrownBy(() -> storage().get(location()))
            .isNotInstanceOf(ResponseStatusException.class)
            .hasMessage("Platform file download failed");
    }

    @Test void binaryDownloadRemainsStreamingAndUnchanged() throws Exception {
        byte[] binary = {0, (byte) 255, (byte) 128, 13, 10};
        when(transport.get(anyMap())).thenReturn(Response.builder().status(200).reason("OK")
            .request(request()).headers(Map.of()).body(binary).build());
        try (InputStream stream = storage().get(location())) {
            assertThat(stream.readAllBytes()).containsExactly(binary);
        }
    }

    @SuppressWarnings("unchecked")
    private PlatformRoutedStorage storage() {
        PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
        when(gateway.isRemote()).thenReturn(true);
        when(gateway.params(any(Object[].class))).thenCallRealMethod();
        when(gateway.safe(any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(0)).get());
        ObjectProvider<PlatformStorageClient> provider = mock(ObjectProvider.class);
        when(provider.getObject()).thenReturn(transport);
        return new PlatformRoutedStorage(legacy, gateway, provider);
    }

    private StorageLocation location() {
        return StorageLocation.of("COMMON_FILE", "byclaw-owner", "/by/.sessions/123/file.png");
    }

    private Response response(int status, String json) {
        return Response.builder().status(status).reason("Unavailable").request(request())
            .headers(Map.of()).body(json, StandardCharsets.UTF_8).build();
    }

    private Request request() {
        return Request.create(Request.HttpMethod.GET, "http://platform.test/internal/platform/storage/content",
            Map.of(), null, StandardCharsets.UTF_8, null);
    }
}
