package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatForwardController;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.ForwardSourceRead;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import org.junit.jupiter.api.*;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.io.*;
import java.util.*;

class GroupChatForwardControllerTest {
    GroupChatForwardService forwards=mock(GroupChatForwardService.class);
    GroupChatForwardTargetQueryService targets=mock(GroupChatForwardTargetQueryService.class);
    GroupChatForwardQueryService queries=mock(GroupChatForwardQueryService.class);
    TenantGroupForwardService tenant=mock(TenantGroupForwardService.class);
    MockMvc mvc;
    ForwardActor actor=new ForwardActor(30,1);
    @BeforeEach void setup(){
        var login=new LoginInfo();login.setUserId(30L);login.setEnterpriseId(1L);CurrentUserHolder.setLoginInfo(login);
        mvc=MockMvcBuilders.standaloneSetup(new GroupChatForwardController(forwards,targets,queries,tenant)).build();
        var result=new ForwardOperation(9007199254740993L,ForwardOperationState.RUNNING,List.of(new ForwardTarget(20,ForwardState.PENDING,List.of(),null,false)));
        when(forwards.create(eq(actor),eq(10L),any())).thenReturn(result);when(forwards.status(actor,10,9007199254740993L)).thenReturn(result);when(forwards.retry(eq(actor),eq(10L),eq(9007199254740993L),any())).thenReturn(result);
        when(targets.listTargets(actor,10,1,20,null)).thenReturn(new PageInfo<>());
        when(queries.items(actor,20,50,20,null)).thenReturn(new ItemPage(List.of(),20,false,null));
    }
    @AfterEach void clear(){CurrentUserHolder.clearLoginInfo();TenantRequestContextHolder.clear();}
    @Test void sixPublicRoutesUseExactContractAndStrictRawBody() throws Exception {
        mvc.perform(post("/group-chats/10/message-forwards").contentType("application/json").content("{\"clientRequestId\":\"k\",\"mode\":\"SINGLE\",\"messageIds\":[\"50\"],\"targetSessionIds\":[\"20\"]}"))
            .andExpect(status().isAccepted()).andExpect(jsonPath("$.data.forwardRequestId").value("9007199254740993")).andExpect(jsonPath("$.data.targets[0].status").value("PENDING")).andExpect(jsonPath("$.data.requestId").doesNotExist());
        mvc.perform(get("/group-chats/10/message-forwards/9007199254740993")).andExpect(status().isOk());
        mvc.perform(post("/group-chats/10/message-forwards/9007199254740993/retry").contentType("application/json").content("{\"targetSessionIds\":[\"20\"]}")).andExpect(status().isOk());
        mvc.perform(get("/group-chats/10/forward-targets")).andExpect(status().isOk());
        mvc.perform(get("/group-chats/20/messages/50/forward-items")).andExpect(status().isOk()).andExpect(jsonPath("$.data.items").isArray());
        for(String body:List.of("{\"clientRequestId\":\"k\",\"mode\":\"SINGLE\",\"messageIds\":[50],\"targetSessionIds\":[\"20\"]}","{\"actor\":\"31\"}"))mvc.perform(post("/group-chats/10/message-forwards").contentType("application/json").content(body)).andExpect(status().isBadRequest());
        mvc.perform(post("/group-chats/10/message-forwards/9007199254740993/retry").contentType("application/json").content("{\"targetSessionIds\":[\"20\"],\"actor\":\"31\"}")).andExpect(status().isBadRequest());
        mvc.perform(get("/group-chats/10/forward-targets?enterpriseId=1")).andExpect(status().isBadRequest());
        mvc.perform(get("/group-chats/20/messages/50/forward-items?pageSize=0")).andExpect(status().isBadRequest());
    }
    @Test void obsoleteAttachmentRouteIsNotExposed() throws Exception {
        mvc.perform(get("/group-chats/20/messages/50/forward-attachments/file")).andExpect(status().isNotFound());
        verifyNoInteractions(queries);
    }

    @Test void tenantRoutingNeverFallsBackIncludingDevelopment() throws Throwable {
        String original=System.getProperty("BE_ENV");
        System.setProperty("BE_ENV","development");
        try {
            var context=new TenantRequestContext(30,1,"MEMBER");TenantRequestContextHolder.set(context);
            var local=mock(com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyGroupChatForwardStore.class);
            var policy=mock(ForwardPlatformPolicy.class);
            var app=new GroupChatForwardService(local,tenant,null,policy,null,null,null,null,null);
            var result=new ForwardOperation(9007199254740993L,ForwardOperationState.RUNNING,List.of());
            when(tenant.prepare(eq(actor),eq(10L),any())).thenReturn(result);
            when(tenant.targets(actor,10,1,20,null)).thenReturn(new PageInfo<>());
            var advice=spy(new TenantGroupChatRoutingAspect(mock(TenantNodeClient.class),mock(com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService.class),mock(com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper.class),new com.fasterxml.jackson.databind.ObjectMapper(),mock(TenantGroupMemberService.class)));
            var factory=new org.springframework.aop.aspectj.annotation.AspectJProxyFactory(new GroupChatForwardController(app,targets,queries,tenant));factory.setProxyTargetClass(true);factory.addAspect(advice);
            var proxy=(GroupChatForwardController)factory.getProxy();
            var http=MockMvcBuilders.standaloneSetup(proxy).build();
            http.perform(post("/group-chats/10/message-forwards").contentType("application/json").content("{\"clientRequestId\":\"k\",\"mode\":\"SINGLE\",\"messageIds\":[\"50\"],\"targetSessionIds\":[\"20\"]}")).andExpect(status().isAccepted());
            http.perform(get("/group-chats/10/forward-targets")).andExpect(status().isOk());
            verify(advice,atLeast(2)).route(any());verifyNoInteractions(local,targets);
            when(tenant.targets(actor,10,1,20,null)).thenThrow(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE));
            http.perform(get("/group-chats/10/forward-targets")).andExpect(status().isServiceUnavailable());verifyNoInteractions(local,targets);
        } finally { if(original==null)System.clearProperty("BE_ENV");else System.setProperty("BE_ENV",original); }
    }

    @Test void originalActorCanReadReceiptAfterSourceLeaveButOtherBindingsCannot() throws Exception {
        var fixture=new GroupChatForwardServiceTest();fixture.setup();
        var operation=fixture.store.prepare(actor,10,fixture.input("http-receipt"));
        fixture.db.update("DELETE FROM byai.byai_session_member WHERE session_id=10");
        var app=new GroupChatForwardService(fixture.store,null,null,mock(ForwardPlatformPolicy.class),null,null,null,null,null);
        var http=MockMvcBuilders.standaloneSetup(new GroupChatForwardController(app,targets,queries,tenant)).build();
        String path="/group-chats/10/message-forwards/"+operation.requestId();
        http.perform(get(path)).andExpect(status().isOk()).andExpect(jsonPath("$.data.forwardRequestId").value(Long.toString(operation.requestId())));
        http.perform(get("/group-chats/11/message-forwards/"+operation.requestId())).andExpect(status().isNotFound());
        var login=new LoginInfo();login.setUserId(31L);login.setEnterpriseId(1L);CurrentUserHolder.setLoginInfo(login);
        http.perform(get(path)).andExpect(status().isNotFound());login.setUserId(30L);login.setEnterpriseId(2L);CurrentUserHolder.setLoginInfo(login);
        http.perform(get(path)).andExpect(status().isNotFound());
    }

}
