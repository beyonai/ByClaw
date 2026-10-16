package com.iwhalecloud.byai.state.application.service.filepreview;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.state.domain.resource.converter.FileConverterContext;

@ExtendWith(MockitoExtension.class)
class FilePreviewApplicationServiceTest {

    private static final byte[] OLE_HEADER = {
        (byte) 0xd0, (byte) 0xcf, 0x11, (byte) 0xe0, (byte) 0xa1, (byte) 0xb1, 0x1a, (byte) 0xe1
    };

    @Mock
    private FileConverterContext converter;

    private FilePreviewApplicationService service;

    @BeforeEach
    void setUp() {
        ResourceBundleMessageSource messages = new ResourceBundleMessageSource();
        messages.setBasename("i18n/messages");
        messages.setDefaultEncoding("UTF-8");
        LocaleContextHolder.setLocale(Locale.US);
        service = new FilePreviewApplicationService(converter, messages);
    }

    @AfterEach
    void tearDown() {
        LocaleContextHolder.resetLocaleContext();
    }

    @ParameterizedTest
    @ValueSource(strings = {"DOC", "PPT"})
    void convertsAnInMemoryCopyWithNormalizedType(String extension) throws Exception {
        byte[] pdf = "%PDF-preview".getBytes(StandardCharsets.US_ASCII);
        when(converter.convertFileToPdf(any(), eq("preview." + extension.toLowerCase(Locale.ROOT)))).thenReturn(pdf);
        byte[] original = OLE_HEADER.clone();
        MockMultipartFile file = new MockMultipartFile("file", "合同." + extension, "application/octet-stream", original);

        assertThat(service.convert(file)).isSameAs(pdf);
        assertThat(file.getBytes()).containsExactly(original);
        verify(converter).convertFileToPdf(eq(original), eq("preview." + extension.toLowerCase(Locale.ROOT)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"file.docx", "file.pptx", "file.pdf", "file.wps", "doc", "file"})
    void leavesOtherFormatsOnTheirExistingPreviewPaths(String fileName) {
        MockMultipartFile file = new MockMultipartFile("file", fileName, "application/octet-stream", OLE_HEADER);
        assertStatus(file, 415);
        verifyNoInteractions(converter);
    }

    @Test
    void rejectsEmptyOversizedAndRenamedNonOfficeInputBeforeConversion() {
        assertStatus(new MockMultipartFile("file", "empty.doc", "application/msword", new byte[0]), 400);
        MultipartFile large = mock(MultipartFile.class);
        when(large.getOriginalFilename()).thenReturn("large.ppt");
        when(large.getSize()).thenReturn((long) FilePreviewApplicationService.MAX_FILE_SIZE + 1);
        assertStatus(large, 413);
        assertStatus(new MockMultipartFile("file", "renamed.doc", "application/msword", "<html/>".getBytes(StandardCharsets.UTF_8)), 422);
        verifyNoInteractions(converter);
    }

    @Test
    void mapsParserFailuresToLocalizedErrors() throws Exception {
        when(converter.convertFileToPdf(any(), any())).thenThrow(new IllegalArgumentException("internal parser details"));
        MockMultipartFile file = new MockMultipartFile("file", "broken.doc", "application/msword", OLE_HEADER);
        assertThatThrownBy(() -> service.convert(file)).isInstanceOfSatisfying(ResponseStatusException.class, error -> {
            assertThat(error.getStatusCode().value()).isEqualTo(422);
            assertThat(error.getReason()).contains("Conversion failed").doesNotContain("internal parser details");
        });
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        assertThatThrownBy(() -> service.convert(file)).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getReason()).contains("文件转换失败"));
    }

    private void assertStatus(MultipartFile file, int status) {
        assertThatThrownBy(() -> service.convert(file)).isInstanceOfSatisfying(ResponseStatusException.class,
            error -> assertThat(error.getStatusCode().value()).isEqualTo(status));
    }
}
