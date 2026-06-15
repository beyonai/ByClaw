package com.iwhalecloud.byai.manager.application.service.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

class FileStorageUserSpaceProvisionerTest {

    @TempDir
    Path tempDir;

    @Test
    void ensureUserSpaceCreatesUserPrivateByDirectory() {
        FileStorageUserSpaceProvisioner provisioner = provisioner(tempDir.toString());

        Path created = provisioner.ensureUserSpace("byclaw-user001");

        assertThat(created).isEqualTo(tempDir.resolve("byclaw-user001/by"));
        assertThat(tempDir.resolve("byclaw-user001/by")).isDirectory();
    }

    @Test
    void ensureUserSpaceRejectsRelativeRoot() {
        FileStorageUserSpaceProvisioner provisioner = provisioner("relative/root");

        assertThatThrownBy(() -> provisioner.ensureUserSpace("byclaw-user001"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("must be absolute");
    }

    @Test
    void ensureUserSpaceRejectsTraversal() {
        FileStorageUserSpaceProvisioner provisioner = provisioner(tempDir.toString());

        assertThatThrownBy(() -> provisioner.ensureUserSpace("../escape"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Path traversal");
    }

    private FileStorageUserSpaceProvisioner provisioner(String fileRoot) {
        FileStorageUserSpaceProvisioner provisioner = new FileStorageUserSpaceProvisioner();
        ReflectionTestUtils.setField(provisioner, "fileRoot", fileRoot);
        return provisioner;
    }
}
