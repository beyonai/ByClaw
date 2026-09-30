package com.iwhalecloud.byai.state.domain.linkpreview.interfaces;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.linkpreview.application.LinkPreviewService;
import com.iwhalecloud.byai.state.domain.linkpreview.dto.LinkPreviewResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class LinkPreviewControllerTest {
    private final LinkPreviewService service = mock(LinkPreviewService.class);

    @AfterEach
    void clearUser() { CurrentUserHolder.clearLoginInfo(); }

    @Test
    void refusesUnauthenticatedRequestsBeforeFetching() throws Exception {
        CurrentUserHolder.clearLoginInfo();
        MockMvcBuilders.standaloneSetup(new LinkPreviewController(service)).build()
            .perform(post("/link-preview").contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://example.com\"}"))
            .andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
    }

    @Test
    void returnsMetadataInTheExistingResponseEnvelope() throws Exception {
        LoginInfo login = new LoginInfo();
        login.setUserId(1L);
        CurrentUserHolder.setLoginInfo(login);
        when(service.preview(anyString())).thenReturn(new LinkPreviewResponse(true, "Title", "Summary", "", "", "Site"));
        MockMvcBuilders.standaloneSetup(new LinkPreviewController(service)).build()
            .perform(post("/link-preview").contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://example.com\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.resolved").value(true)).andExpect(jsonPath("$.data.title").value("Title"));
    }

    @Test
    void refusesEmptyAndOversizedUrls() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new LinkPreviewController(service)).build();
        for (String url : new String[] { "", "x".repeat(4097) }) {
            mvc.perform(post("/link-preview").contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"" + url + "\"}")).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service);
    }
}
