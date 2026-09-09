package com.iwhalecloud.byai.state.interfaces.controller.openapi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.domain.message.qo.MessageQo;

@ExtendWith(MockitoExtension.class)
class OpenApiInnerControllerTest {

    @Mock
    private ByaiMessageHotService messageService;

    @InjectMocks
    private OpenApiInnerController controller;

    @BeforeEach
    void setUp() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void getMessages_forcesCreatorIdFromCurrentUser() {
        MessageQo request = new MessageQo();
        request.setSessionId(9L);
        request.setTopK(20);
        request.setCreatorId(999L);

        when(messageService.getMessages(any(MessageQo.class))).thenReturn(Collections.emptyList());

        controller.getMessages(request);

        ArgumentCaptor<MessageQo> captor = ArgumentCaptor.forClass(MessageQo.class);
        verify(messageService).getMessages(captor.capture());
        MessageQo passed = captor.getValue();
        assertThat(passed.getSessionId()).isEqualTo(9L);
        assertThat(passed.getTopK()).isEqualTo(20);
        assertThat(passed.getCreatorId()).isEqualTo(1001L);
    }

    @Test
    void getMessages_returnsServiceResult() {
        ByaiMessageHotDto message = new ByaiMessageHotDto();
        message.setMessageId(1L);
        when(messageService.getMessages(any(MessageQo.class))).thenReturn(List.of(message));

        var response = controller.getMessages(new MessageQo());

        assertThat(response.getData()).isEqualTo(List.of(message));
    }
}
