package com.iwhalecloud.byai.gateway.sandbox.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;

class PlatformPrivateFileSystemRoutingConfigurationTest {
    @Test
    void existingStorageRootProvidesLogicalAddressWithoutNewEnvironmentSetting() {
        assertRoot(Map.of("file.storage.local.path", "/existing/storage"), "/existing/storage");
    }

    @Test
    void explicitCanonicalRootTakesPriorityOverLocalStorageRoot() {
        assertRoot(Map.of("file.storage.local.path", "/existing/storage",
            "byclaw.platform.canonical-file-root", "/explicit/platform"), "/explicit/platform");
    }

    @Test
    void existingSandboxVolumeRootIsAlsoAcceptedAsLogicalAddress() {
        assertRoot(Map.of("byclaw.sandbox.volume.file-root", "/existing/volume"), "/existing/volume");
    }

    @Test
    void absentRootFailsClosed() {
        try (var context = context(Map.of())) {
            assertThatThrownBy(() -> context.getBean(PlatformPrivateFileSystemRouting.class).trustedRoot())
                .isInstanceOf(PlatformPrivateFileSystemRouting.RemoteFailure.class)
                .hasMessageContaining("canonical-file-root");
        }
    }

    private void assertRoot(Map<String, Object> properties, String root) {
        try (var context = context(properties)) {
            assertThat(context.getBean(PlatformPrivateFileSystemRouting.class).trustedRoot()).isEqualTo(Path.of(root));
        }
    }

    private AnnotationConfigApplicationContext context(Map<String, Object> properties) {
        var context = new AnnotationConfigApplicationContext();
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("test", properties));
        PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
        when(gateway.params(any(Object[].class))).thenCallRealMethod();
        context.registerBean(PlatformRemoteGateway.class, () -> gateway);
        context.register(PlatformPrivateFileSystemRouting.class);
        context.refresh();
        return context;
    }
}
