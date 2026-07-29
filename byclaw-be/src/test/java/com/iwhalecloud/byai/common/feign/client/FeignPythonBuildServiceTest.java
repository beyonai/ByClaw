package com.iwhalecloud.byai.common.feign.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.common.exception.BaseException;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class FeignPythonBuildServiceTest {

    @Test
    void validateDownloadResponse_rejectsQaFailureEnvelope() {
        FeignPythonBuildService service = new FeignPythonBuildService();
        byte[] response = "{\"resultCode\":\"-1\",\"resultMsg\":\"file not found\",\"resultObject\":{}}"
            .getBytes(StandardCharsets.UTF_8);

        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service, "validateDownloadResponse",
            new ByteArrayInputStream(response), "/api/v1/downloadFile"))
            .isInstanceOf(BaseException.class)
            .hasMessage("file not found");
    }

    @Test
    void validateDownloadResponse_preservesRegularFileContent() throws Exception {
        FeignPythonBuildService service = new FeignPythonBuildService();
        byte[] response = "{\"document\":\"regular json file\"}".getBytes(StandardCharsets.UTF_8);

        InputStream validated = ReflectionTestUtils.invokeMethod(service, "validateDownloadResponse",
            new ByteArrayInputStream(response), "/api/v1/downloadFile");

        assertThat(validated).isNotNull();
        assertThat(validated.readAllBytes()).isEqualTo(response);
    }
}
