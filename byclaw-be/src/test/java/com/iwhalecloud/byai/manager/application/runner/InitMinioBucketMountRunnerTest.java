package com.iwhalecloud.byai.manager.application.runner;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.ResourceFS;
import com.iwhalecloud.byai.common.storage.KnowledgeResourceFS;
import com.iwhalecloud.byai.common.storage.config.MinioConfig;

class InitMinioBucketMountRunnerTest {

    @Test
    void run_fileBackendStillInitializesMinioBuckets() throws Exception {
        InitMinioBucketMountRunner runner = new InitMinioBucketMountRunner();
        ResourceFS resourceFS = mock(ResourceFS.class);
        KnowledgeResourceFS knowledgeResourceFS = mock(KnowledgeResourceFS.class);
        ReflectionTestUtils.setField(runner, "storageType", "minio");
        ReflectionTestUtils.setField(runner, "volumeBackend", "file");
        ReflectionTestUtils.setField(runner, "resourceFS", resourceFS);
        ReflectionTestUtils.setField(runner, "knowledgeResourceFS", knowledgeResourceFS);
        ReflectionTestUtils.setField(runner, "minioConfig", new MinioConfig());

        runner.run(null);

        verify(resourceFS).init();
        verify(knowledgeResourceFS).init();
    }
}
