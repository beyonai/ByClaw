package com.iwhalecloud.byai.state.application.service.upload;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ResumableUploadPolicyTest {
    private static final long MB = 1024L * 1024;
    @Test void missingFieldsKeepDefaultsWithoutDatabaseRows() {
        var policy = ResumableUploadPolicy.fromJson("{\"enabled\":false,\"maxFileSize\":0}");
        assertEquals(4096 * MB, policy.maxSize());
        assertEquals(4 * MB, policy.chunkSize());
    }
    @Test void effectiveLimitRespectsGlobalCeilingAndPlatformChunkBudget() {
        var policy = ResumableUploadPolicy.fromJson("{\"maxFileSize\":512,\"resumableMaxFileSizeMB\":8192,\"resumableChunkSizeMB\":1}");
        assertEquals(512 * MB, policy.effective(16384 * MB, MB, 16 * MB, 1024).maxSize());
        var unlimited = ResumableUploadPolicy.fromJson("{\"resumableMaxFileSizeMB\":8192,\"resumableChunkSizeMB\":1}");
        assertEquals(1024 * MB, unlimited.effective(16384 * MB, MB, 16 * MB, 1024).maxSize());
    }
    @Test void rejectsInvalidOrFractionalPolicyInsteadOfSilentlyCoercingIt() {
        for (String json : new String[]{"{\"resumableChunkSizeMB\":0}", "{\"resumableChunkSizeMB\":17}",
                "{\"resumableChunkSizeMB\":1.5}", "{\"resumableMaxFileSizeMB\":-1}",
                "{\"resumableMaxFileSizeMB\":\"4096\"}", "[]"}) {
            assertThrows(IllegalArgumentException.class, () -> ResumableUploadPolicy.fromJson(json), json);
        }
    }
    @Test void systemParameterWritesValidateBeforeAnyPersistenceOrCacheMutation() {
        var config = new com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig();
        config.setParamCode(ResumableUploadPolicy.CONFIG_CODE);
        config.setParamValue("{\"resumableChunkSizeMB\":17}");
        var application = new com.iwhalecloud.byai.manager.application.service.staticdata.SystemConfigApplicationService();
        assertThrows(IllegalArgumentException.class, () -> application.saveSystemConfig(config));
        assertThrows(IllegalArgumentException.class, () -> application.updateSystemConfig(config));
    }

}
