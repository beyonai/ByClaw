package com.iwhalecloud.byai.gateway.sandbox.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;

class SandboxVolumeBackendValidatorTest {

    @Test
    void validate_fileBackendRequiresAbsoluteFileRoot() {
        SandboxProperties properties = new SandboxProperties();
        properties.getVolume().setBackend("file");
        properties.getVolume().setFileRoot("relative/path");

        SandboxVolumeBackendValidator validator = validator(properties);

        assertThatThrownBy(validator::validate)
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("absolute path");
    }

    @Test
    void validate_fileBackendAcceptsCephfsAbsoluteRoot() {
        SandboxProperties properties = new SandboxProperties();
        properties.getVolume().setBackend("file");
        properties.getVolume().setFileRoot("/mnt/byclaw-file");
        properties.getVolume().setFileType("cephfs");

        SandboxVolumeBackendValidator validator = validator(properties);

        assertThatCode(validator::validate).doesNotThrowAnyException();
    }

    @Test
    void validate_minioMountBackendIsAcceptedForLegacyDeployments() {
        SandboxProperties properties = new SandboxProperties();
        properties.getVolume().setBackend("minio-mount");

        SandboxVolumeBackendValidator validator = validator(properties);

        assertThatCode(validator::validate).doesNotThrowAnyException();
    }

    @Test
    void validate_unknownBackendFailsFast() {
        SandboxProperties properties = new SandboxProperties();
        properties.getVolume().setBackend("unknown");

        SandboxVolumeBackendValidator validator = validator(properties);

        assertThatThrownBy(validator::validate)
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Unsupported sandbox volume backend");
    }

    @Test
    void validate_unknownFileTypeFailsFast() {
        SandboxProperties properties = new SandboxProperties();
        properties.getVolume().setBackend("file");
        properties.getVolume().setFileRoot("/mnt/byclaw-file");
        properties.getVolume().setFileType("object-store");

        SandboxVolumeBackendValidator validator = validator(properties);

        assertThatThrownBy(validator::validate)
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Unsupported sandbox file volume type");
    }

    @Test
    void bind_volumePropertiesFromEnvironment() {
        MockEnvironment environment = new MockEnvironment()
            .withProperty("byclaw.sandbox.volume.backend", "file")
            .withProperty("byclaw.sandbox.volume.file-root", "/mnt/byclaw-file")
            .withProperty("byclaw.sandbox.volume.file-type", "cephfs")
            .withProperty("byclaw.sandbox.volume.snapshot-provider", "ceph")
            .withProperty("byclaw.sandbox.volume.file-browser-enabled", "true");

        SandboxProperties properties = Binder.get(environment)
            .bind("byclaw.sandbox", Bindable.of(SandboxProperties.class))
            .orElseThrow(() -> new IllegalStateException("Failed to bind sandbox properties"));

        assertThatCode(() -> validator(properties).validate()).doesNotThrowAnyException();
        assertThat(properties.getVolume().getBackend()).isEqualTo("file");
        assertThat(properties.getVolume().getFileRoot()).isEqualTo("/mnt/byclaw-file");
        assertThat(properties.getVolume().getFileType()).isEqualTo("cephfs");
        assertThat(properties.getVolume().getSnapshotProvider()).isEqualTo("ceph");
        assertThat(properties.getVolume().isFileBrowserEnabled()).isTrue();
    }

    private SandboxVolumeBackendValidator validator(SandboxProperties properties) {
        SandboxVolumeBackendValidator validator = new SandboxVolumeBackendValidator(properties);
        ReflectionTestUtils.setField(validator, "sandboxEnabled", true);
        return validator;
    }
}
