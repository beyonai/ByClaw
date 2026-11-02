package com.iwhalecloud.byai.gateway.sandbox.platform;

import java.io.IOException;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class UserWorkspaceRoutingTest {
    @Test void remoteInitializationPreservesTheOwnerBucket() throws Exception {
        PlatformRemoteGateway gateway=mock(PlatformRemoteGateway.class);
        when(gateway.isRemote()).thenReturn(true);
        doCallRealMethod().when(gateway).params(any(Object[].class));
        new PlatformBusinessStorageRouting(gateway,null).createUserSpace("byclaw-alice",()->fail("remote must not touch BE files"));
        verify(gateway).call("storage","create-directories",Map.of("namespace","workspace","bucketOrRoot","byclaw-alice","path","by"));
    }
    @Test void remoteFailureNeverInitializesLocalStorage() {
        PlatformRemoteGateway gateway=mock(PlatformRemoteGateway.class);when(gateway.isRemote()).thenReturn(true);
        doThrow(new IllegalStateException("unavailable")).when(gateway).call(anyString(),anyString(),any());
        assertThrows(IllegalStateException.class,()->new PlatformBusinessStorageRouting(gateway,null).createUserSpace("byclaw-alice",()->fail("no fallback")));
    }
    @Test void invalidOwnerCannotEscapeTheWorkspace() {
        PlatformRemoteGateway gateway=mock(PlatformRemoteGateway.class);
        for(String bucket:new String[]{"","../alice","byclaw-../alice","shared-alice"})
            assertThrows(IllegalArgumentException.class,()->new PlatformBusinessStorageRouting(gateway,null).createUserSpace(bucket,()->fail("invalid owner")));
        verifyNoInteractions(gateway);
    }
    @Test void legacyInitializationPreservesItsIOException() {
        PlatformRemoteGateway gateway=mock(PlatformRemoteGateway.class);IOException expected=new IOException("disk failure");
        IOException failure=assertThrows(IOException.class,()->new PlatformBusinessStorageRouting(gateway,null).createUserSpace("byclaw-alice",()->{throw expected;}));
        assertSame(expected,failure);verify(gateway,never()).call(anyString(),anyString(),any());
    }
}
