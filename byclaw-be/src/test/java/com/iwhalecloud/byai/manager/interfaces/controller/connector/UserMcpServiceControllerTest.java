package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.iwhalecloud.byai.manager.domain.usermcp.UserMcpServiceFacade;
import com.iwhalecloud.byai.manager.dto.usermcp.UserMcpServiceDto;
import com.iwhalecloud.byai.manager.dto.usermcp.UserMcpServiceRequest;

@ExtendWith(MockitoExtension.class)
class UserMcpServiceControllerTest {

    @Mock
    private UserMcpServiceFacade facade;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new UserMcpServiceController(facade, () -> 42L)).build();
    }

    @Test
    void createUsesCurrentUserAndNeverEchoesCredential() throws Exception {
        when(facade.create(any(UserMcpServiceRequest.class), org.mockito.ArgumentMatchers.eq(42L)))
            .thenReturn(dto(99L));

        mockMvc.perform(post("/connector/mcp-services")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "resourceCode":"personal-search",
                      "resourceName":"Personal Search",
                      "sourceContent":"{}",
                      "credentialInput":{"type":"BEARER_TOKEN","value":"canary-secret"}
                    }
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.resourceId").value(99))
            .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("canary-secret"))));
    }

    @Test
    void listAndDeleteRemainOwnerScopedThroughFacade() throws Exception {
        when(facade.list(42L)).thenReturn(List.of(dto(99L)));

        mockMvc.perform(get("/connector/mcp-services"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].resourceId").value(99));
        mockMvc.perform(delete("/connector/mcp-services/99"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").value(true));

        verify(facade).list(42L);
        verify(facade).delete(99L, 42L);
    }

    private UserMcpServiceDto dto(Long resourceId) {
        return new UserMcpServiceDto(
            resourceId,
            "personal-search",
            "Personal Search",
            "description",
            "{\"public\":true}",
            1L,
            "fingerprint",
            700L,
            List.of()
        );
    }
}
