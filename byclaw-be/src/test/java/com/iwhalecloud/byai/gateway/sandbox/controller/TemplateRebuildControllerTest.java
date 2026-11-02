package com.iwhalecloud.byai.gateway.sandbox.controller;

import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.springframework.web.server.ResponseStatusException;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;

class TemplateRebuildControllerTest {
    @AfterEach void clear(){CurrentUserHolder.clearLoginInfo();}
    @Test void serverDerivesOperatorAndRejectsForgedActorFields(){
        PlatformRemoteGateway remote=mock(PlatformRemoteGateway.class);when(remote.isRemote()).thenReturn(true);
        LoginInfo login=new LoginInfo();login.setUserCode("realadmin");login.setUserName("真实管理员");
        UsersOrganization org=new UsersOrganization();org.setUserType("PLAT_MAN");login.setUsersOrganizations(List.of(org));CurrentUserHolder.setLoginInfo(login);
        new TemplateRebuildController(remote).start(Map.of("serviceKey","byclaw-dsh","requestId","request-1234567890","actorName","伪造用户","actorCode","forged"));
        verify(remote).controller(eq("templateRebuild/start"),argThat(p->"realadmin".equals(p.get("actorCode"))&&"真实管理员".equals(p.get("actorName"))));
    }
    @Test void ordinaryUsersCannotRebuildOrReadOperatorRecords(){
        PlatformRemoteGateway remote=mock(PlatformRemoteGateway.class);TemplateRebuildController controller=new TemplateRebuildController(remote);
        assertThrows(ResponseStatusException.class,()->controller.start(Map.of("serviceKey","byclaw-dsh")));
        assertThrows(ResponseStatusException.class,()->controller.records(Map.of()));verifyNoInteractions(remote);
    }
}
