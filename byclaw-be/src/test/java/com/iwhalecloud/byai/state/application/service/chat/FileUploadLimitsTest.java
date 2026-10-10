package com.iwhalecloud.byai.state.application.service.chat;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;

import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.log.exception.BaseRuntimeException;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.Arrays;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

/** 两条上传链路共用同一组边界用例，防止数量和大小的零值语义再次分歧。 */
class FileUploadLimitsTest {

    private enum UploadPath {
        SESSION,
        KNOWLEDGE
    }

    @ParameterizedTest
    @EnumSource(UploadPath.class)
    void zeroCountAndSizeAllowMultipleLargeFiles(UploadPath path) {
        assertThatCode(() -> checkUpload(path,
            "{\"enabled\":true,\"maxFileCount\":0,\"maxFileSize\":0}",
            100L * 1024 * 1024, 100L * 1024 * 1024)).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @EnumSource(UploadPath.class)
    void missingLimitsDefaultToUnlimited(UploadPath path) {
        assertThatCode(() -> checkUpload(path, "{}", 100L * 1024 * 1024, 1L))
            .doesNotThrowAnyException();
    }

    @ParameterizedTest
    @EnumSource(UploadPath.class)
    void missingSystemConfigurationDoesNotAddLimits(UploadPath path) {
        assertThatCode(() -> checkUpload(path, null, 100L * 1024 * 1024, 1L))
            .doesNotThrowAnyException();
    }

    @ParameterizedTest
    @EnumSource(UploadPath.class)
    void positiveCountAllowsTheExactLimitWithUnlimitedSize(UploadPath path) {
        assertThatCode(() -> checkUpload(path,
            "{\"maxFileCount\":2,\"maxFileSize\":0}", 100L * 1024 * 1024, 1L))
            .doesNotThrowAnyException();
    }

    @ParameterizedTest
    @EnumSource(UploadPath.class)
    void positiveCountRejectsAnExcessWithUnlimitedSize(UploadPath path) {
        // 隔离文案解析，确认抛出的是数量校验异常，而不是未初始化的国际化上下文异常。
        try (var messages = mockStatic(I18nUtil.class, invocation -> invocation.getArgument(0))) {
            assertThatThrownBy(() -> checkUpload(path,
                "{\"maxFileCount\":2,\"maxFileSize\":0}", 1L, 1L, 1L))
                .isInstanceOf(exceptionType(path))
                .hasMessage("file.upload.count.exceeded");
        }
    }

    @ParameterizedTest
    @EnumSource(UploadPath.class)
    void positiveSizeAllowsTheExactByteLimitWithUnlimitedCount(UploadPath path) {
        assertThatCode(() -> checkUpload(path,
            "{\"maxFileCount\":0,\"maxFileSize\":10}", 10L * 1024 * 1024, 1L))
            .doesNotThrowAnyException();
    }

    @ParameterizedTest
    @EnumSource(UploadPath.class)
    void positiveSizeRejectsOneExcessByteWithUnlimitedCount(UploadPath path) {
        try (var messages = mockStatic(I18nUtil.class, invocation -> invocation.getArgument(0))) {
            assertThatThrownBy(() -> checkUpload(path,
                "{\"maxFileCount\":0,\"maxFileSize\":10}", 10L * 1024 * 1024 + 1))
                .isInstanceOf(exceptionType(path))
                .hasMessage("file.upload.size.exceeded");
        }
    }

    @ParameterizedTest
    @EnumSource(UploadPath.class)
    void explicitDisabledRetainsTheExistingBackendBypass(UploadPath path) {
        assertThatCode(() -> checkUpload(path,
            "{\"enabled\":false,\"maxFileCount\":1,\"maxFileSize\":1}",
            100L * 1024 * 1024, 100L * 1024 * 1024)).doesNotThrowAnyException();
    }

    private void checkUpload(UploadPath path, String config, long... sizes) {
        Object service = path == UploadPath.SESSION
            ? new AssistantChatApplicationService(mock(GatewayClient.class))
            : new SsSuperAssistKwCatalogApplicationService();
        ByaiSystemConfigService systemConfig = mock(ByaiSystemConfigService.class);
        when(systemConfig.getDcSystemConfigValueByCode("DIG_EMPLOYEE_FILE_UPLOAD_CONFIG"))
            .thenReturn(config);
        ReflectionTestUtils.setField(service, "byaiSystemConfigService", systemConfig);
        // 只模拟文件元数据，不分配大文件内容，聚焦配置边界与实际校验入口。
        MultipartFile[] files = Arrays.stream(sizes).mapToObj(size -> {
            MultipartFile file = mock(MultipartFile.class);
            when(file.getSize()).thenReturn(size);
            return file;
        }).toArray(MultipartFile[]::new);
        ReflectionTestUtils.invokeMethod(service, "checkUploadInfo", files, null);
    }

    private Class<?> exceptionType(UploadPath path) {
        return path == UploadPath.SESSION ? BaseException.class : BaseRuntimeException.class;
    }
}
