package com.iwhalecloud.byai.state.application.service.upload;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Locale;
import java.util.stream.IntStream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

@ExtendWith(MockitoExtension.class)
class GlobalFileUploadValidatorTest extends I18nTestSupport {

    private static final String CONFIG_CODE = "DIG_EMPLOYEE_FILE_UPLOAD_CONFIG";

    private static final long MB = 1024L * 1024L;

    @Mock
    private ByaiSystemConfigService systemConfigService;

    private GlobalFileUploadValidator validator;

    @BeforeEach
    void setUp() {
        validator = new GlobalFileUploadValidator(systemConfigService);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"null", "{}", "{\"maxFileSize\":0}", "{\"maxFileSize\":-1}"})
    void missingOrNonPositiveSizeDoesNotImposeALimit(String config) {
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE)).thenReturn(config);
        MultipartFile file = mock(MultipartFile.class);

        assertThatCode(() -> validator.validateSize(new MultipartFile[]{file})).doesNotThrowAnyException();
        verifyNoInteractions(file);
    }

    @Test
    void allowsExactLimitAndDoesNotSumBatchSizes() {
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE))
            .thenReturn("{\"maxFileSize\":512}");

        // 仅模拟元数据，不在测试中分配数百 MB；批次总量大于 512MB 也应允许。
        MultipartFile[] files = {fileOfSize(512 * MB), fileOfSize(300 * MB)};
        assertThatCode(() -> validator.validateSize(files)).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @ValueSource(strings = {"zh-CN", "en-US"})
    void rejectsAnOversizedFileAnywhereInTheBatchWithLocalizedFeedback(String language) {
        LocaleContextHolder.setLocale(Locale.forLanguageTag(language));
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE))
            .thenReturn("{\"maxFileSize\":512}");
        long oversizedBytes = 512 * MB + 1;
        MultipartFile[] files = {fileOfSize(MB), fileOfSize(oversizedBytes)};

        assertThatThrownBy(() -> validator.validateSize(files))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage(I18nUtil.get("file.upload.size.exceeded", 512L, oversizedBytes / (double) MB));
    }

    @Test
    void chatAttachmentSwitchDoesNotDisableTheFileSpaceSizeLimit() {
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE))
            .thenReturn("{\"enabled\":false,\"maxFileSize\":1}");

        assertThatThrownBy(() -> validator.validateSize(new MultipartFile[]{fileOfSize(MB + 1)}))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void readsTheLatestConfigurationForEachUpload() {
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE))
            .thenReturn("{\"maxFileSize\":512}", "{\"maxFileSize\":1}");
        MultipartFile[] files = {fileOfSize(2 * MB)};

        assertThatCode(() -> validator.validateSize(files)).doesNotThrowAnyException();
        assertThatThrownBy(() -> validator.validateSize(files)).isInstanceOf(IllegalArgumentException.class);
        verify(systemConfigService, times(2)).getDcSystemConfigValueByCode(CONFIG_CODE);
    }

    @Test
    void aVeryLargeConfiguredLimitDoesNotOverflowIntoARejection() {
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE))
            .thenReturn("{\"maxFileSize\":9223372036854775807}");
        MultipartFile file = mock(MultipartFile.class);

        assertThatCode(() -> validator.validateSize(new MultipartFile[]{file})).doesNotThrowAnyException();
        verifyNoInteractions(file);
    }

    @Test
    void emptyBatchDoesNotReadConfiguration() {
        validator.validateSize(null);
        validator.validateSize(new MultipartFile[0]);
        validator.validateKnowledgeUpload(null);
        validator.validateKnowledgeUpload(new MultipartFile[0]);

        verifyNoInteractions(systemConfigService);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"null", "{}", "{\"maxFileCount\":0}", "{\"maxFileCount\":-1}"})
    void knowledgeUploadDoesNotUseAFixedCountWhenConfigurationIsMissingOrNonPositive(String config) {
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE)).thenReturn(config);

        assertThatCode(() -> validator.validateKnowledgeUpload(filesWithCount(12))).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 12})
    void knowledgeUploadAllowsCountsBelowOrExactlyAtTheConfiguredLimit(int count) {
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE))
            .thenReturn("{\"maxFileCount\":12,\"maxFileSize\":0}");

        assertThatCode(() -> validator.validateKnowledgeUpload(filesWithCount(count))).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @ValueSource(strings = {"zh-CN", "en-US"})
    void knowledgeUploadRejectsExcessCountWithLocalizedFeedbackEvenWhenSizeIsUnlimited(String language) {
        LocaleContextHolder.setLocale(Locale.forLanguageTag(language));
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE))
            .thenReturn("{\"maxFileCount\":2,\"maxFileSize\":0}");
        MultipartFile[] files = filesWithCount(3);

        assertThatThrownBy(() -> validator.validateKnowledgeUpload(files))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage(I18nUtil.get("file.upload.count.exceeded", 2L, 3));
        verifyNoInteractions((Object[]) files);
    }

    @Test
    void knowledgeUploadStillChecksFileSizeWhenCountIsUnlimited() {
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE))
            .thenReturn("{\"maxFileCount\":0,\"maxFileSize\":1}");

        assertThatThrownBy(() -> validator.validateKnowledgeUpload(new MultipartFile[]{fileOfSize(MB + 1)}))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage(I18nUtil.get("file.upload.size.exceeded", 1L, (MB + 1) / (double) MB));
    }

    @Test
    void knowledgeUploadReadsTheCurrentCountForEachBatch() {
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE))
            .thenReturn("{\"maxFileCount\":12}", "{\"maxFileCount\":1}");
        MultipartFile[] files = filesWithCount(2);

        assertThatCode(() -> validator.validateKnowledgeUpload(files)).doesNotThrowAnyException();
        assertThatThrownBy(() -> validator.validateKnowledgeUpload(files)).isInstanceOf(IllegalArgumentException.class);
        verify(systemConfigService, times(2)).getDcSystemConfigValueByCode(CONFIG_CODE);
    }

    @Test
    void fileSpaceSizeValidationDoesNotIntroduceAKnowledgeCountLimit() {
        when(systemConfigService.getDcSystemConfigValueByCode(CONFIG_CODE))
            .thenReturn("{\"maxFileCount\":1,\"maxFileSize\":0}");

        assertThatCode(() -> validator.validateSize(filesWithCount(2))).doesNotThrowAnyException();
    }

    private MultipartFile[] filesWithCount(int count) {
        return IntStream.range(0, count).mapToObj(index -> mock(MultipartFile.class)).toArray(MultipartFile[]::new);
    }

    private MultipartFile fileOfSize(long size) {
        MultipartFile file = mock(MultipartFile.class);
        when(file.getSize()).thenReturn(size);
        return file;
    }
}
