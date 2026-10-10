package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminMemberService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class TenantAdminMemberControllerTest {

    @Test
    void addAcceptsEnterpriseIdAndUserCodeOnlyInJsonBody() throws Exception {
        TenantAdminMemberService service = mock(TenantAdminMemberService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new TenantAdminMemberController(service)).build();

        mvc.perform(post("/admin/tenants/members/add")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"enterpriseId\":\"123\",\"userCode\":\"0027024710\"}"))
            .andExpect(status().isOk());

        verify(service).add("123", "0027024710");
    }

    @Test
    void listAcceptsEnterpriseIdOnlyInJsonBody() throws Exception {
        TenantAdminMemberService service = mock(TenantAdminMemberService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new TenantAdminMemberController(service)).build();

        mvc.perform(post("/admin/tenants/members/list")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"enterpriseId\":\"123\"}"))
            .andExpect(status().isOk());

        verify(service).list("123");
    }
}
