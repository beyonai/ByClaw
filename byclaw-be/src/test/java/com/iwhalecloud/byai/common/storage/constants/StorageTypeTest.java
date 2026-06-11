package com.iwhalecloud.byai.common.storage.constants;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class StorageTypeTest {

    @Test
    void matchesTreatsFileAsLocalFilesystemAlias() {
        assertThat(StorageType.matches("file", "local")).isTrue();
        assertThat(StorageType.matches("local", "file")).isTrue();
        assertThat(StorageType.matches("file", "minio")).isFalse();
    }
}
