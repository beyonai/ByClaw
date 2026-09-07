package com.iwhalecloud.byai.state.domain.chat.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MessageFactoryTest {

    private MessageFactory messageFactory;

    @Mock
    private ByaiSystemConfigService byaiSystemConfigService;

    @BeforeEach
    void setUp() {
        messageFactory = new MessageFactory();
        ReflectionTestUtils.setField(messageFactory, "byaiSystemConfigService", byaiSystemConfigService);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(7L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void generateAskMessage_marksMessageAsCurrentUsersInput() {
        when(byaiSystemConfigService.getDcSystemConfigValueByCode(Constants.AGENT_RESOURCE_PROJECT_ID))
            .thenReturn("31");

        ByaiMessageHotDtoDto message = messageFactory.generateAskMessage(11L, "hello", 13L);

        assertThat(message.getSessionId()).isEqualTo(11L);
        assertThat(message.getMessageId()).isEqualTo(13L);
        assertThat(message.getMessageContent()).isEqualTo("hello");
        assertThat(message.getUsage()).isEqualTo(ChatUseageEnum.USER_INPUT.getCode());
        assertThat(message.getCreatorId()).isEqualTo(7L);
    }
}
