package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.nio.file.Path;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
@DisabledOnOs(OS.WINDOWS)
class RecorderBycliPathResolverTest {

    @Test
    void resolvesExactOwnerToBackendAndSandboxVisiblePaths() {
        RecorderBycliPathResolver resolver = resolver("/mnt/byclaw-file");

        RecorderBycliPaths paths = resolver.resolve(new RecorderOwner(42L, "AbC_001"), "session_1", "draft_0");

        assertThat(paths.backendPath()).isEqualTo(Path.of(
            "/mnt/byclaw-file/byclaw-AbC_001/by/.bycli/.recorder-drafts/session_1/draft_0.js"
        ));
        assertThat(paths.daemonPath()).isEqualTo(Path.of(
            "/by/.bycli/.recorder-drafts/session_1/draft_0.js"
        ));
    }

    @Test
    void preservesUserCodeWithoutTrimmingOrDerivingItFromUserId() {
        RecorderBycliPathResolver resolver = resolver("/mnt/byclaw-file");

        RecorderBycliPaths paths = resolver.resolve(new RecorderOwner(42L, " MixedCase "), "session", "draft");

        assertThat(paths.backendPath()).isEqualTo(Path.of(
            "/mnt/byclaw-file/byclaw- MixedCase /by/.bycli/.recorder-drafts/session/draft.js"
        ));
    }

    @ParameterizedTest
    @MethodSource("unsafeSegments")
    void rejectsUnsafeOwnerSessionAndDraftSegments(String unsafe) {
        RecorderBycliPathResolver resolver = resolver("/mnt/byclaw-file");

        assertUnsafe(() -> resolver.resolve(new RecorderOwner(42L, unsafe), "session", "draft"));
        assertUnsafe(() -> resolver.resolve(new RecorderOwner(42L, "alice"), unsafe, "draft"));
        assertUnsafe(() -> resolver.resolve(new RecorderOwner(42L, "alice"), "session", unsafe));
    }

    @Test
    void rejectsNullOwnerAndUnavailableOrRelativeFileRoot() {
        assertUnsafe(() -> resolver("/mnt/byclaw-file").resolve(null, "session", "draft"));
        assertStorageUnavailable(() -> resolver(null).resolve(new RecorderOwner(42L, "alice"), "session", "draft"));
        assertStorageUnavailable(() -> resolver("  ").resolve(new RecorderOwner(42L, "alice"), "session", "draft"));
        assertStorageUnavailable(() -> resolver("relative/root").resolve(new RecorderOwner(42L, "alice"), "session", "draft"));
    }

    private static Stream<String> unsafeSegments() {
        return Stream.of("", "   ", ".", "..", "a/b", "a\\b", "a\nb", "a\u0000b");
    }

    private RecorderBycliPathResolver resolver(String fileRoot) {
        SandboxProperties properties = new SandboxProperties();
        properties.getVolume().setFileRoot(fileRoot);
        return new RecorderBycliPathResolver(properties);
    }

    private void assertUnsafe(org.assertj.core.api.ThrowableAssert.ThrowingCallable callable) {
        assertThatThrownBy(callable)
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");
    }

    private void assertStorageUnavailable(org.assertj.core.api.ThrowableAssert.ThrowingCallable callable) {
        assertThatThrownBy(callable)
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");
    }
}
