package com.iwhalecloud.byai.gateway.sandbox.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import java.net.URI;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressFacade;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class OpensandboxIngressControllerTest {

    @Test
    void proxyFilebrowser_extractsRequestPathFromIngressRoute() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get("/filebrowser/files/list").queryParam("foo", "bar"))
            .andExpect(status().isOk());

        verify(facade).forward(eq("filebrowser"), eq("/files/list"), any(), any());
    }

    @Test
    void proxyFilebrowser_preservesTrailingSlashInRequestPath() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get("/filebrowser/api/usage/"))
            .andExpect(status().isOk());

        verify(facade).forward(eq("filebrowser"), eq("/api/usage/"), any(), any());
    }

    @Test
    void proxyFilebrowser_preservesRequestPathBehindContextPath() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get("/byaiService/filebrowser/api/usage/")
                .contextPath("/byaiService"))
            .andExpect(status().isOk());

        verify(facade).forward(eq("filebrowser"), eq("/api/usage/"), any(), any());
    }

    @Test
    void proxyFilebrowser_preservesEncodedRequestPath() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get(URI.create("/filebrowser/files/a%2Fb.txt")))
            .andExpect(status().isOk());

        verify(facade).forward(eq("filebrowser"), eq("/files/a%2Fb.txt"), any(), any());
    }

    @Test
    void proxyFilebrowser_preservesRootTrailingSlash() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get("/filebrowser/"))
            .andExpect(status().isOk());

        verify(facade).forward(eq("filebrowser"), eq("/"), any(), any());
    }

    @Test
    void proxyNovnc_extractsRequestPathFromRoute() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get("/novnc/vnc.html").queryParam("autoconnect", "true"))
            .andExpect(status().isOk());

        verify(facade).forward(eq("novnc"), eq("/vnc.html"), any(), any());
    }

    @Test
    void proxyOpenDesign_extractsRequestPathFromRoute() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get("/openDesign/projects/1001"))
            .andExpect(status().isOk());

        verify(facade).forward(eq("openDesign"), eq("/projects/1001"), any(), any());
    }

    @Test
    void proxyOpenDesign_preservesRequestPathBehindContextPath() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get("/byaiService/openDesign/projects/1001")
                .contextPath("/byaiService"))
            .andExpect(status().isOk());

        verify(facade).forward(eq("openDesign"), eq("/projects/1001"), any(), any());
    }

    @Test
    void proxyOpenSandboxApi_preservesPathBehindContextPath() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get("/byaiService/v1/sandboxes/sb-1/proxy/6080/vnc.html")
                .contextPath("/byaiService")
                .queryParam("foo", "bar"))
            .andExpect(status().isOk());

        verify(facade).forwardOpenSandboxPath(eq("/v1/sandboxes/sb-1/proxy/6080/vnc.html"), any(), any());
    }

    @Test
    void prefixedFilebrowserRouteIsNotSupported() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get("/sandboxes/ingress/filebrowser/files/list").queryParam("foo", "bar"))
            .andExpect(status().isNotFound());

        verify(facade, never()).forward(any(), any(), any(), any());
    }

    @Test
    void nonIngressRootRouteIsNotIntercepted() throws Exception {
        SandboxIngressFacade facade = org.mockito.Mockito.mock(SandboxIngressFacade.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new OpensandboxIngressController(facade)).build();

        mockMvc.perform(get("/chat/superAgentChat"))
            .andExpect(status().isNotFound());

        verify(facade, never()).forward(any(), any(), any(), any());
    }
}
