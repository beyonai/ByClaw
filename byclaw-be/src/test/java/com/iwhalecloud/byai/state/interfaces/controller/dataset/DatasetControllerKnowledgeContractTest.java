package com.iwhalecloud.byai.state.interfaces.controller.dataset;

import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileCountResult;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileCountRequest;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class DatasetControllerKnowledgeContractTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {
    private DatasetApplicationService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(DatasetApplicationService.class);
        DatasetController controller = new DatasetController();
        ReflectionTestUtils.setField(controller, "datasetApplicationService", service);
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

    private MockMultipartFile part(String name, String value, String type) {
        return new MockMultipartFile(name, "", type, value.getBytes(StandardCharsets.UTF_8));
    }
}
