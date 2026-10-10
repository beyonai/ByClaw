package com.iwhalecloud.byai.manager.interfaces.controller.auth;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class AuthControllerTest {
    private MessageSource originalMessages;

    @BeforeEach void setup() {
        originalMessages = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        MessageSource messages = mock(MessageSource.class);
        when(messages.getMessage(anyString(), any(), any(Locale.class))).thenAnswer(call -> call.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
    }

    @AfterEach void cleanup() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessages);
        CurrentUserHolder.clearLoginInfo();
    }

    /** 旧使用授权、分享、归属及批量接口也必须通过个人资源校验，不可绕过新人员设置接口。 */
    @ParameterizedTest
    @ValueSource(strings = {"DIG_EMPLOYEE", "SKILL", "KG_DOC", "TOOLKIT"})
    void legacyAuthorizationEndpointsRejectPersonalResourcesBeforeWriting(String bizType) {
        LoginInfo login = new LoginInfo(); login.setUserId(2L);
        UsersOrganization role = new UsersOrganization(); role.setUserType("PLAT_MAN");
        login.setUsersOrganizations(List.of(role)); CurrentUserHolder.setLoginInfo(login);
        for (String owner : List.of("personal", "personal_default")) {
            AuthController controller = new AuthController();
            AuthApplicationService auth = spy(new AuthApplicationService());
            SsResourceService resources = mock(SsResourceService.class);
            ReflectionTestUtils.setField(controller, "authApplicationService", auth);
            ReflectionTestUtils.setField(controller, "ssResourceService", resources);
            SsResource resource = new SsResource();
            resource.setResourceId(10L); resource.setResourceBizType(bizType); resource.setOwnerType(owner);
            when(resources.findById(10L)).thenReturn(resource);
            AuthRedBlackDTO request = new AuthRedBlackDTO(); request.setGrantObjId(10L);
            assertThatThrownBy(() -> controller.availableUseAuth(request)).isInstanceOf(BaseException.class)
                .hasMessage("auth.personal.resource.authorization.not.allowed");
            assertThatThrownBy(() -> controller.shareUseAuth(request)).isInstanceOf(BaseException.class)
                .hasMessage("auth.personal.resource.authorization.not.allowed");
            assertThatThrownBy(() -> controller.ownerAuth(request)).isInstanceOf(BaseException.class)
                .hasMessage("auth.personal.resource.authorization.not.allowed");
            assertThatThrownBy(() -> controller.allowManageAuth(request)).isInstanceOf(BaseException.class)
                .hasMessage("auth.personal.resource.authorization.not.allowed");
            assertThatThrownBy(() -> controller.batchHandleAuth(request)).isInstanceOf(BaseException.class)
                .hasMessage("auth.personal.resource.authorization.not.allowed");
            verify(auth, never()).handleAuth(any());
            verify(auth, never()).batchHandleAuth(any());
        }
    }
}
