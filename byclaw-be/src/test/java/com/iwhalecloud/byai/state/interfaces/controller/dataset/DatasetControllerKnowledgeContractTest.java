package com.iwhalecloud.byai.state.interfaces.controller.dataset;

import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileCountResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileCountRequest;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.application.service.upload.GlobalFileUploadValidator;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.multipart.MultipartFile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class DatasetControllerKnowledgeContractTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    private DatasetApplicationService service;
    private ByaiSystemConfigService systemConfigService;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(DatasetApplicationService.class);
        systemConfigService = mock(ByaiSystemConfigService.class);
        DatasetController controller = new DatasetController();
        ReflectionTestUtils.setField(controller, "datasetApplicationService", service);
        ReflectionTestUtils.setField(controller, "globalFileUploadValidator",
            new GlobalFileUploadValidator(systemConfigService));
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void fileCountAcceptsResourceIdAndReturnsZeroForAnEmptyLibrary() throws Exception {
        var result = new KnowledgeFileCountResult();
        result.setFileCount(0L);
        when(service.fileCount(any())).thenReturn(result);
        mvc.perform(post("/datasetController/knowledgeBases/fileCount")
                .contentType(MediaType.APPLICATION_JSON).content("{\"resourceId\":42}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.fileCount").value(0));
        var request = ArgumentCaptor.forClass(KnowledgeFileCountRequest.class);
        verify(service).fileCount(request.capture());
        assertThat(request.getValue().getResourceId()).isEqualTo(42L);
    }

    @Test
    void fileCountRejectsMissingResourceId() throws Exception {
        mvc.perform(post("/datasetController/knowledgeBases/fileCount")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void uploadForwardsRawZipFlagAndMetadata() throws Exception {
        when(service.uploadFiles(any(), eq(42L), any(), any(), any(), any(), anyBoolean(), any(), any(), any()))
            .thenReturn(new UploadResult());
        mvc.perform(multipart("/datasetController/uploadFiles")
                .file(new MockMultipartFile("files", "raw.zip", "application/zip", new byte[]{1, 2, 3}))
                .file(part("resourceId", "42", MediaType.APPLICATION_JSON_VALUE))
                .file(part("directoryPath", "/docs", MediaType.TEXT_PLAIN_VALUE))
                .file(part("extractZip", "false", MediaType.TEXT_PLAIN_VALUE))
                .file(part("processFrontMatter", "false", MediaType.TEXT_PLAIN_VALUE))
                .file(part("metadata", "{\"owner\":\"HR\"}", MediaType.TEXT_PLAIN_VALUE)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        verify(service).uploadFiles(any(), eq(42L), eq("/docs"), isNull(), eq(false), eq(false), eq(false), eq(false),
            eq("{\"owner\":\"HR\"}"), any());
    }

    @Test
    void omittedImportOptionsStayAbsentForQaDefaults() throws Exception {
        when(service.uploadFiles(any(), eq(42L), any(), any(), any(), any(), anyBoolean(), any(), any(), any()))
            .thenReturn(new UploadResult());
        mvc.perform(multipart("/datasetController/uploadFiles")
                .file(new MockMultipartFile("files", "raw.zip", "application/zip", new byte[]{1}))
                .file(part("resourceId", "42", MediaType.APPLICATION_JSON_VALUE))
                .file(part("directoryPath", "/docs", MediaType.TEXT_PLAIN_VALUE)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        verify(service).uploadFiles(any(), eq(42L), eq("/docs"), isNull(), isNull(), eq(false), eq(false), isNull(),
            isNull(), any());
    }

    @Test
    void uploadRejectsAnOversizedBatchBeforeImportOrOverwrite() throws Exception {
        when(systemConfigService.getDcSystemConfigValueByCode("DIG_EMPLOYEE_FILE_UPLOAD_CONFIG"))
            .thenReturn("{\"maxFileSize\":1}");

        mvc.perform(multipart("/datasetController/uploadFiles")
                .file(new MockMultipartFile("files", "small.pdf", "application/pdf", new byte[]{1}))
                .file(new MockMultipartFile("files", "large.pdf", "application/pdf", new byte[1024 * 1024 + 1]))
                .file(part("resourceId", "42", MediaType.APPLICATION_JSON_VALUE))
                .file(part("directoryPath", "/docs", MediaType.TEXT_PLAIN_VALUE))
                .file(part("overwrite", "true", MediaType.TEXT_PLAIN_VALUE)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(-1))
            .andExpect(jsonPath("$.msg").value(containsString("1MB")));

        verifyNoInteractions(service);
    }

    @Test
    void uploadAcceptsFilesAtTheLimitEvenWhenTheirTotalExceedsIt() throws Exception {
        when(systemConfigService.getDcSystemConfigValueByCode("DIG_EMPLOYEE_FILE_UPLOAD_CONFIG"))
            .thenReturn("{\"maxFileSize\":1}");
        when(service.uploadFiles(any(), eq(42L), any(), any(), any(), any(), anyBoolean(), any(), any(), any()))
            .thenReturn(new UploadResult());

        mvc.perform(multipart("/datasetController/uploadFiles")
                .file(new MockMultipartFile("files", "first.pdf", "application/pdf", new byte[1024 * 1024]))
                .file(new MockMultipartFile("files", "second.pdf", "application/pdf", new byte[1024 * 1024]))
                .file(part("resourceId", "42", MediaType.APPLICATION_JSON_VALUE))
                .file(part("directoryPath", "/docs", MediaType.TEXT_PLAIN_VALUE)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));

        verify(service).uploadFiles(any(), eq(42L), eq("/docs"), isNull(), isNull(), eq(false), eq(false), isNull(),
            isNull(), any());
    }

    @Test
    void uploadRejectsTheConfiguredExcessCountBeforeImportOrOverwrite() throws Exception {
        when(systemConfigService.getDcSystemConfigValueByCode("DIG_EMPLOYEE_FILE_UPLOAD_CONFIG"))
            .thenReturn("{\"maxFileCount\":1,\"maxFileSize\":0}");

        mvc.perform(multipart("/datasetController/uploadFiles")
                .file(new MockMultipartFile("files", "first.pdf", "application/pdf", new byte[]{1}))
                .file(new MockMultipartFile("files", "second.pdf", "application/pdf", new byte[]{1}))
                .file(part("resourceId", "42", MediaType.APPLICATION_JSON_VALUE))
                .file(part("directoryPath", "/docs", MediaType.TEXT_PLAIN_VALUE))
                .file(part("overwrite", "true", MediaType.TEXT_PLAIN_VALUE)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(-1))
            .andExpect(jsonPath("$.msg").value(
                I18nUtil.get("file.upload.count.exceeded", 1L, 2)));

        verifyNoInteractions(service);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"maxFileCount\":0}", "{\"maxFileCount\":12}"})
    void uploadAcceptsMoreThanTenFilesAccordingToTheCurrentConfiguration(String config) throws Exception {
        when(systemConfigService.getDcSystemConfigValueByCode("DIG_EMPLOYEE_FILE_UPLOAD_CONFIG"))
            .thenReturn(config);
        when(service.uploadFiles(any(), eq(42L), any(), any(), any(), any(), anyBoolean(), any(), any(), any()))
            .thenReturn(new UploadResult());
        MockMultipartHttpServletRequestBuilder request = multipart("/datasetController/uploadFiles")
            .file(part("resourceId", "42", MediaType.APPLICATION_JSON_VALUE))
            .file(part("directoryPath", "/docs", MediaType.TEXT_PLAIN_VALUE));
        for (int index = 0; index < 12; index++) {
            request.file(new MockMultipartFile("files", "document-" + index + ".pdf", "application/pdf", new byte[]{1}));
        }

        mvc.perform(request).andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));

        ArgumentCaptor<MultipartFile[]> files = ArgumentCaptor.forClass(MultipartFile[].class);
        verify(service).uploadFiles(files.capture(), eq(42L), eq("/docs"), isNull(), isNull(), eq(false), eq(false),
            isNull(), isNull(), any());
        assertThat(files.getValue()).hasSize(12);
    }

    private MockMultipartFile part(String name, String value, String type) {
        return new MockMultipartFile(name, "", type, value.getBytes(StandardCharsets.UTF_8));
    }
}
