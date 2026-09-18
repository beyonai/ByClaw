package com.iwhalecloud.byai.state.interfaces.controller.index;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.state.application.service.index.IndexApplicationServiceV2;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class DigitEmployManControllerV2Test {

    @Test
    void groupScopedEmployeeLookupUsesTheSameAgentInvitationPermission() {
        IndexApplicationServiceV2 service = mock(IndexApplicationServiceV2.class);
        GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
        DigitEmployManControllerV2 controller = new DigitEmployManControllerV2();
        ReflectionTestUtils.setField(controller, "digitEmployManServiceV2", service);
        ReflectionTestUtils.setField(controller, "groupAuthorizationService", authorization);

        MyAuthEmployQo request = new MyAuthEmployQo();
        request.setExcludeGroupSessionId(123L);
        PageInfo<AuthDigitEmployVo> page = mock(PageInfo.class);
        when(service.queryMyAuthEmploy(request)).thenReturn(page);

        ResponseUtil<?> response = controller.queryMyAuthEmploy(request);

        verify(authorization).requireInvite(123L, "AGENT");
        verify(service).queryMyAuthEmploy(request);
        assertThat(response.getData()).isSameAs(page);
    }
}
