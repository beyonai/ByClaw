package com.iwhalecloud.byai.state.application.service.filebrowser;

import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformStorageClient;
import com.iwhalecloud.byai.state.application.service.upload.GlobalFileUploadValidator;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class FileBrowserTransferApplicationServiceTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    @Test void unfinishedTargetsRoundTripThroughStatusAndAbortWithRealByDirectoryNames() {
        String[] storedPaths={"by/by/file.bin","by/by/nested/file.bin","by/folder/by/file.bin","/by/by/by/file.bin","by/folder/file.bin"};
        String[] directories={"/by/by","/by/by/nested","/folder/by","/by/by/by","/folder"};
        for(int index=0;index<storedPaths.length;index++) {
            String stored=storedPaths[index];String normalized=stored.startsWith("/")?stored:"/"+stored;
            when(gateway.call(eq("storage"),eq("uploads/list"),any())).thenReturn(Map.of("uploads",java.util.List.of(
                Map.of("uploadId",request.uploadId(),"path",stored,"totalSize",42L,"state","UPLOADING"))));
            doAnswer(call->{
                Map<?,?> target=call.getArgument(2);assertEquals(normalized,target.get("path"));
                return Map.of("state","UPLOADING");
            }).when(gateway).call(eq("storage"),eq("uploads/status"),any());
            doAnswer(call->{
                Map<?,?> target=call.getArgument(2);assertEquals(normalized,target.get("path"));
                return Map.of("state","EXPIRED");
            }).when(gateway).call(eq("storage"),eq("uploads/abort"),any());
            Map<?,?> response=(Map<?,?>)service.unfinished("Alice",10L);
            var entries=(java.util.List<?>)response.get("uploads");assertEquals(1,entries.size());
            Map<?,?> entry=(Map<?,?>)entries.get(0);assertEquals(directories[index],entry.get("path"));
            var selected=new FileBrowserTransferApplicationService.UploadRequest(10L,(String)entry.get("path"),
                (String)entry.get("fileName"),(String)entry.get("uploadId"),null,null,null);
            service.control("Alice","status",selected);service.control("Alice","abort",selected);
        }
    }
    @Test void unfinishedListDerivesOwnerAndHidesProtectedOrForeignPaths() {
        when(gateway.call(eq("storage"),eq("uploads/list"),any())).thenAnswer(call->{
            Map<?,?> target=call.getArgument(2);
            assertEquals("byclaw-alice",target.get("bucketOrRoot"));
            assertEquals("workspace:user:Alice",target.get("ownerKey"));assertEquals("/by",target.get("path"));
            return Map.of("uploads",java.util.List.of(
                Map.of("uploadId",request.uploadId(),"path","/by/folder/large.bin","totalSize",42L,"state","UPLOADING"),
                Map.of("uploadId",request.uploadId(),"path","/by/.connector-auth/key","totalSize",42L,"state","UPLOADING"),
                Map.of("uploadId",request.uploadId(),"path","/outside/file","totalSize",42L,"state","UPLOADING")));
        });
        Map<?,?> result=(Map<?,?>)service.unfinished("Alice",10L);
        var uploads=(java.util.List<?>)result.get("uploads");assertEquals(1,uploads.size());
        Map<?,?> entry=(Map<?,?>)uploads.get(0);assertEquals("/folder",entry.get("path"));
        assertEquals("large.bin",entry.get("fileName"));
    }
    @Test void unfinishedListRejectsMissingLoginAndInvalidResource() {
        assertThrows(IllegalArgumentException.class,()->service.unfinished("",10L));
        assertThrows(IllegalArgumentException.class,()->service.unfinished("Alice",0L));
        verify(gateway,never()).call(anyString(),anyString(),any());
    }
    private final PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
    private final GlobalFileUploadValidator validator = mock(GlobalFileUploadValidator.class);
    private final ObjectProvider<PlatformStorageClient> clients = mock(ObjectProvider.class);
    private FileBrowserTransferApplicationService service;
    private final FileBrowserTransferApplicationService.UploadRequest request =
        new FileBrowserTransferApplicationService.UploadRequest(10L, "/by/.sessions/test/", "large.bin",
            "a85d80e7-b538-4903-b7a2-452d090b4d62", 8388608L, "a".repeat(64), "application/octet-stream");

    @BeforeEach void setup() {
        when(gateway.isRemote()).thenReturn(true);
        service = new FileBrowserTransferApplicationService(gateway, clients, validator, "file");
        lenient().when(gateway.call(eq("storage"), eq("uploads/status"), any())).thenReturn(Map.of("state", "NOT_FOUND"));
        lenient().when(validator.resumablePolicy()).thenReturn(
            com.iwhalecloud.byai.state.application.service.upload.ResumableUploadPolicy.fromJson("{}"));
    }

    @Test void derivesPrivateTargetAndOwnerFromAuthenticatedUser() {
        var client = mock(PlatformStorageClient.class);
        when(clients.getObject()).thenReturn(client);
        when(gateway.safe(any())).thenAnswer(call -> ((java.util.function.Supplier<?>) call.getArgument(0)).get());
        when(client.uploadCapabilities()).thenReturn(Map.of("code", 0));
        when(gateway.data(any())).thenReturn(Map.of("resumable",true,"range",true,"chunkSize", 4194304L, "maxSize", 4294967296L));
        when(gateway.call(eq("storage"), eq("uploads/create"), any())).thenAnswer(call -> call.getArgument(2));
        Map<?, ?> result = (Map<?, ?>) service.control("Alice", "create", request);
        assertEquals("byclaw-alice", result.get("bucketOrRoot"));
        assertEquals("/by/.sessions/test/large.bin", result.get("path"));
        assertEquals("workspace:user:Alice", result.get("ownerKey"));
        assertEquals("private", result.get("shareType"));
        verify(validator).validateSize(8388608L);
    }

    @Test void doesNotAllowCredentialsOrTraversalToReachPlatform() {
        var invalid = new FileBrowserTransferApplicationService.UploadRequest(10L, "/by/.connector-auth/", "key",
            request.uploadId(), 1L, request.sha256(), request.contentType());
        assertThrows(IllegalArgumentException.class, () -> service.control("Alice", "create", invalid));
        var traversal = new FileBrowserTransferApplicationService.UploadRequest(10L, "/by/", "../escape",
            request.uploadId(), 1L, request.sha256(), request.contentType());
        assertThrows(IllegalArgumentException.class, () -> service.control("Alice", "status", traversal));
        verify(gateway, never()).call(anyString(), anyString(), any());
    }

    @Test void rejectsUnauthenticatedAndLegacyTransfers() {
        assertThrows(IllegalArgumentException.class, () -> service.control("", "status", request));
        when(gateway.isRemote()).thenReturn(false);
        assertFalse(service.enabled());
        assertThrows(IllegalStateException.class, () -> service.control("Alice", "create", request));
        verify(gateway, never()).call(anyString(), anyString(), any());
    }

    @Test void remoteFailureIsPropagatedWithoutChangingRoute() {
        when(gateway.call(eq("storage"), eq("uploads/status"), any())).thenThrow(new IllegalStateException("offline"));
        assertEquals("offline", assertThrows(IllegalStateException.class,
            () -> service.control("Alice", "status", request)).getMessage());
    }
    @Test void chunkUsesBoundedStreamingAndServerDerivedIdentity() throws Exception {
        var client = mock(PlatformStorageClient.class);
        when(clients.getObject()).thenReturn(client);
        when(gateway.safe(any())).thenAnswer(call -> ((java.util.function.Supplier<?>) call.getArgument(0)).get());
        when(gateway.data(any())).thenAnswer(call -> call.getArgument(0));
        when(client.uploadChunk(anyMap(), anyString(), any())).thenAnswer(call -> {
            assertNotNull(com.iwhalecloud.byai.gateway.sandbox.platform.PlatformStreamingClient.upload());
            Map<String, Object> params = call.getArgument(0);
            assertEquals("byclaw-alice", params.get("bucketOrRoot"));
            assertEquals("workspace:user:Alice", params.get("ownerKey"));
            assertEquals(1, params.get("index"));
            return Map.of("code", 0);
        });
        var part = new org.springframework.mock.web.MockMultipartFile("chunk", new byte[]{1, 2, 3});
        service.chunk("Alice", request, 1, request.sha256(), part);
        assertNull(com.iwhalecloud.byai.gateway.sandbox.platform.PlatformStreamingClient.upload());
    }

    @Test void rejectsOversizeChunkBeforeOpeningPlatformConnection() {
        var part = mock(org.springframework.web.multipart.MultipartFile.class);
        when(part.getSize()).thenReturn(16777217L);
        assertThrows(IllegalArgumentException.class, () -> service.chunk("Alice", request, 0, request.sha256(), part));
        verifyNoInteractions(clients);
    }

    @Test void protectsTransferStagingAtEveryPathDepth() {
        for (String path : java.util.List.of("/by/.byclaw-uploads", "/by/nested/.byclaw-uploads/file")) {
            assertThrows(IllegalArgumentException.class, () -> FileBrowserPathPolicy.assertBrowsable(path));
        }
        verify(gateway, never()).call(anyString(), anyString(), any());
    }

    @Test void advertisesTheTrustedPlatformLimit() {
        var client = mock(PlatformStorageClient.class);
        when(clients.getObject()).thenReturn(client);
        when(gateway.safe(any())).thenAnswer(call -> ((java.util.function.Supplier<?>) call.getArgument(0)).get());
        when(client.uploadCapabilities()).thenReturn(Map.of("code", 0));
        when(gateway.data(any())).thenReturn(Map.of("resumable",true,"range",true,"chunkSize", 4194304L, "maxSize", 4294967296L));
        assertEquals(Map.of("resumable", true, "chunkSize", 4194304L, "maxSize", 4294967296L), service.capabilities());
    }

    @Test void existingSessionKeepsAdmittedPolicyAfterAnAdminChange() {
        when(gateway.call(eq("storage"), eq("uploads/status"), any())).thenReturn(Map.of("state", "UPLOADING",
            "totalSize", request.totalSize(), "sha256", request.sha256(), "chunkSize", 8388608L, "maxSize", 4294967296L));
        when(gateway.call(eq("storage"), eq("uploads/create"), any())).thenAnswer(call -> call.getArgument(2));
        Map<?, ?> sent = (Map<?, ?>) service.control("Alice", "create", request);
        assertFalse(sent.containsKey("chunkSize"));
        assertFalse(sent.containsKey("maxSize"));
        verify(validator, never()).validateSize(anyLong());
        verify(validator, never()).resumablePolicy();
        verifyNoInteractions(clients);
    }

    @Test void explicitUnsupportedCapabilityDoesNotAdvertiseResumableOrUsePolicyFallback() {
        var client=mock(PlatformStorageClient.class);
        when(clients.getObject()).thenReturn(client);
        when(gateway.safe(any())).thenAnswer(call -> ((java.util.function.Supplier<?>)call.getArgument(0)).get());
        when(client.uploadCapabilities()).thenReturn(Map.of("code",0));
        when(gateway.data(any())).thenReturn(Map.of("resumable",false,"range",false));
        assertEquals(Map.of("resumable",false),service.capabilities());
        verify(validator,never()).resumablePolicy();
    }

    @Test void authenticatedCapabilityIsScopedToCanonicalUserBucket() {
        try(var current=org.mockito.Mockito.mockStatic(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.class)) {
            current.when(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder::getCurrentUserCode).thenReturn("Alice");
            var client=mock(PlatformStorageClient.class);when(clients.getObject()).thenReturn(client);
            when(gateway.safe(any())).thenAnswer(call->((java.util.function.Supplier<?>)call.getArgument(0)).get());
            when(client.uploadCapabilitiesFor(anyMap())).thenAnswer(call->{Map<?,?> query=call.getArgument(0);assertEquals("byclaw-alice",query.get("bucketOrRoot"));return Map.of("code",0);});
            when(gateway.data(any())).thenReturn(Map.of("resumable",false,"range",false));
            assertEquals(Map.of("resumable",false),service.capabilities());
            verify(client,never()).uploadCapabilities();
        }
    }

    @Test void unavailablePlatformDoesNotPretendResumableUploadsAreDisabled() {
        var client = mock(PlatformStorageClient.class);
        when(clients.getObject()).thenReturn(client);
        when(gateway.safe(any())).thenAnswer(call -> ((java.util.function.Supplier<?>) call.getArgument(0)).get());
        var unavailable = mock(feign.FeignException.class);
        when(unavailable.status()).thenReturn(503);
        when(client.uploadCapabilities()).thenThrow(unavailable);
        assertSame(unavailable, assertThrows(feign.FeignException.class, service::capabilities));
    }

    @Test void rangeCapabilityIsIndependentFromResumableUploads() {
        var client = mock(PlatformStorageClient.class);
        when(clients.getObject()).thenReturn(client);
        when(gateway.safe(any())).thenAnswer(call -> ((java.util.function.Supplier<?>) call.getArgument(0)).get());
        when(client.uploadCapabilities()).thenReturn(Map.of("code", 0));
        when(gateway.data(any())).thenReturn(Map.of("resumable", false, "range", true));
        assertTrue(service.supportsRange());
        assertEquals(Map.of("resumable", false), service.capabilities());
        verifyNoInteractions(validator);
    }

}
