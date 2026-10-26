package com.iwhalecloud.byai.state.interfaces.controller.dataset;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeMetadataSearchResult;
import com.iwhalecloud.byai.manager.dto.resource.ProjectCloudSearchRequest;
import com.iwhalecloud.byai.state.application.service.dataset.ProjectCloudSearchApplicationService;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

/** 云盘搜索 HTTP 参数边界回归，创建于 2026-10-26，作者 Codex。 */
class ProjectCloudSearchControllerTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {

    private MockMvc mvc;

    private ProjectCloudSearchApplicationService search;

    @BeforeEach
    void setUp() {
        search = mock(ProjectCloudSearchApplicationService.class);
        ProjectCloudSearchController controller = new ProjectCloudSearchController();
        ReflectionTestUtils.setField(controller, "search", search);
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void validatesResourceAndPageBoundsBeforeInvokingSearch() throws Exception {
        for (String body : new String[] {"{}", "{\"resourceId\":100,\"pageNum\":0}",
            "{\"resourceId\":100,\"pageSize\":101}", "{\"resourceId\":100,\"pageSize\":null}"}) {
            mvc.perform(post("/datasetController/projectCloud/search")
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(search);
    }

    @Test
    void acceptsStringResourceIdsWithoutLosingLongPrecision() throws Exception {
        when(search.search(any())).thenReturn(new KnowledgeMetadataSearchResult());
        mvc.perform(post("/datasetController/projectCloud/search")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"resourceId\":\"9007199254740997\",\"keyword\":\"方案\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0));
        ArgumentCaptor<ProjectCloudSearchRequest> request = ArgumentCaptor.forClass(ProjectCloudSearchRequest.class);
        verify(search).search(request.capture());
        assertThat(request.getValue().getResourceId()).isEqualTo(9007199254740997L);
        assertThat(request.getValue().getPageNum()).isEqualTo(1);
    }
}
