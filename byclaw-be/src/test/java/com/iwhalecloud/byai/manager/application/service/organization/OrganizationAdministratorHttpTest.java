package com.iwhalecloud.byai.manager.application.service.organization;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.iwhalecloud.byai.manager.interfaces.controller.organization.OrganizationController;
import com.iwhalecloud.byai.manager.infrastructure.exception.OAuth2ExceptionHandler;
import com.iwhalecloud.byai.manager.vo.organization.OrgTreeVo;
import com.iwhalecloud.byai.state.infrastructure.filter.WebMvcConfiguration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OrganizationAdministratorHttpTest {
    private final OrganizationAdminService admins = mock(OrganizationAdminService.class);
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        var controller = new OrganizationController();
        ReflectionTestUtils.setField(controller, "organizationAdmins", admins);
        List<HttpMessageConverter<?>> converters = new ArrayList<>();
        new WebMvcConfiguration().extendMessageConverters(converters);
        mvc = MockMvcBuilders.standaloneSetup(controller)
            .setMessageConverters(converters.toArray(HttpMessageConverter<?>[]::new))
            .setControllerAdvice(new OAuth2ExceptionHandler()).build();
    }

    @ParameterizedTest
    @ValueSource(strings = {"10026147", "\"10026147\""})
    void actualFastJsonConverterAcceptsOrganizationIdAndSerializesAdministratorFields(String id) throws Exception {
        when(admins.members(10026147L)).thenReturn(List.of(new OrganizationAdminService.Member("8", "管理员甲", true)));
        mvc.perform(post("/system/organization/administrators").contentType(MediaType.APPLICATION_JSON)
                .content("{\"orgId\":" + id + ",\"language\":\"zh-CN\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data[0].userId").value("8"))
            .andExpect(jsonPath("$.data[0].userName").value("管理员甲"))
            .andExpect(jsonPath("$.data[0].administrator").value(true));
        verify(admins).members(10026147L);
    }

    @Test
    void selectionEndpointsAcceptCreationAndEditingContextsWithActualConverter() throws Exception {
        var org = new OrgTreeVo(); org.setOrgId(10L); org.setOrgName("研发部"); org.setParentOrgId(-1L);
        when(admins.getAdministratorOrganizations(null, 10L)).thenReturn(List.of(org));
        mvc.perform(post("/system/organization/administratorOrganizations").contentType(MediaType.APPLICATION_JSON)
                .content("{\"parentOrgId\":10,\"language\":\"zh-CN\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data[0].orgName").value("研发部"));
        when(admins.getAdministratorCandidates(20L, null, 10L))
            .thenReturn(List.of(new OrganizationAdminService.Member("8", "管理员甲", false)));
        mvc.perform(post("/system/organization/administratorCandidates").contentType(MediaType.APPLICATION_JSON)
                .content("{\"orgId\":\"20\",\"memberOrgId\":\"10\",\"language\":\"zh-CN\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data[0].userId").value("8"));
        verify(admins).getAdministratorCandidates(20L, null, 10L);
    }
}
