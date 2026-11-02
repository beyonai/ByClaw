package com.iwhalecloud.byai.state.interfaces.controller.dataset;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileCopyRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileCopyResult;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DatasetControllerCopyTest extends I18nTestSupport {
    private DatasetApplicationService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(7L);
        login.setUserCode("member");
        CurrentUserHolder.setLoginInfo(login);
        service = mock(DatasetApplicationService.class);
        DatasetController controller = new DatasetController();
        ReflectionTestUtils.setField(controller, "datasetApplicationService", service);
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @AfterEach
    void clearLogin() { CurrentUserHolder.clearLoginInfo(); }

    @Test
    void exposesJsonCopyEndpointAndForwardsOnlyAuthenticatedCreatorAndChatContext() throws Exception {
        KnowledgeFileCopyResult result = new KnowledgeFileCopyResult();
        result.setTargetResourceId(200L);
        result.setTargetFilePath("/dest/guide.md");
        result.setSuccess(true);
        when(service.copyKnowledgeFile(any(), any())).thenReturn(result);

        mvc.perform(post("/datasetController/copyKnowledgeFile").contentType(MediaType.APPLICATION_JSON)
                .header("X-USER-CODE", "spoofed").header("X-CHAT-SESSION-ID", "chat-1")
                .header("resource-id", "999")
                .content("""
                    {"sourceResourceId":100,"sourceFilePath":"/source/guide.md",
                     "targetResourceId":200,"targetDirectoryPath":"/dest"}
                    """))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.targetFilePath").value("/dest/guide.md"))
            .andExpect(jsonPath("$.data.success").value(true));

        ArgumentCaptor<KnowledgeFileCopyRequest> request = ArgumentCaptor.forClass(KnowledgeFileCopyRequest.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> headers = ArgumentCaptor.forClass(Map.class);
        verify(service).copyKnowledgeFile(request.capture(), headers.capture());
        assertThat(request.getValue().getSourceResourceId()).isEqualTo(100L);
        assertThat(request.getValue().getTargetResourceId()).isEqualTo(200L);
        assertThat(headers.getValue()).containsExactlyInAnyOrderEntriesOf(
            Map.of("X-USER-CODE", "member", "X-CHAT-SESSION-ID", "chat-1"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}",
        "{\"sourceResourceId\":0,\"sourceFilePath\":\"/a.md\",\"targetResourceId\":2}",
        "{\"sourceResourceId\":1,\"sourceFilePath\":\" \",\"targetResourceId\":2}",
        "{\"sourceResourceId\":1,\"sourceFilePath\":\"/a.md\",\"targetResourceId\":-1}"})
    void rejectsInvalidJsonFieldsBeforeInvokingCopy(String json) throws Exception {
        mvc.perform(post("/datasetController/copyKnowledgeFile").contentType(MediaType.APPLICATION_JSON).content(json))
            .andExpect(status().isBadRequest());

        verifyNoInteractions(service);
    }
}
