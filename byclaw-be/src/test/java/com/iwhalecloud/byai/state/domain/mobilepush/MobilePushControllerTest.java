package com.iwhalecloud.byai.state.domain.mobilepush;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.interfaces.controller.notification.MobilePushController;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class MobilePushControllerTest {
    @AfterEach
    void clearAuthentication() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void missingAuthenticationNeverReturnsKeysOrTouchesBindings() {
        MobilePushProperties properties = new MobilePushProperties();
        MobilePushStore store = mock(MobilePushStore.class);
        var controller = new MobilePushController(properties, store);
        assertThat(controller.configuration().getData()).containsEntry("enabled", false);
        verifyNoInteractions(store);
    }

    @Test
    void bindingUsesAuthenticatedUserAndClientConfigurationNeverContainsServerSecret() {
        LoginInfo login = new LoginInfo();
        login.setUserId(22L);
        CurrentUserHolder.setLoginInfo(login);
        MobilePushProperties properties = new MobilePushProperties();
        properties.setEnabled(true);
        properties.setSdkAppId(123);
        properties.setClientAppKey("test-client-key");
        properties.setSecretKey("test-server-secret");
        MobilePushStore store = mock(MobilePushStore.class);
        var controller = new MobilePushController(properties, store);
        var binding = new PushDeviceBinding("installation-test-device", 1, "registration", "ios", "zh-CN");
        when(store.bind(22, binding)).thenReturn(true);
        assertThat(controller.bind(binding).getData()).containsEntry("enabled", true);
        assertThat(controller.configuration().getData()).doesNotContainKeys("secretKey", "userSig");
        controller.unbind(new MobilePushController.UnbindDevice("installation-test-device", 2));
        verify(store).unbind(22, "installation-test-device", 2);
    }
}
