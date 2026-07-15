package com.iwhalecloud.byai.state.interfaces.controller.notification;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.notification.NotificationQueryDto;
import com.iwhalecloud.byai.manager.vo.notification.NotificationVO;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

class NotificationControllerManageTest {

    @Test
    void exposesNotificationManageEndpoints() throws Exception {
        Class<?> controllerType = Class.forName(
            "com.iwhalecloud.byai.state.interfaces.controller.notification.NotificationController");

        assertNotNull(controllerType.getAnnotation(RestController.class));
        RequestMapping requestMapping = controllerType.getAnnotation(RequestMapping.class);
        assertArrayEquals(new String[] {"/notification"}, requestMapping.value());

        assertPostMapping(controllerType, "getNotificationListByPage", "/getNotificationListByPage");
        assertPostMapping(controllerType, "managePage", "/manage/page");
        assertPostMapping(controllerType, "manageDetail", "/manage/detail");
        assertPostMapping(controllerType, "manageCreate", "/manage/create");
        assertPostMapping(controllerType, "manageUpdate", "/manage/update");
        assertPostMapping(controllerType, "manageDelete", "/manage/delete");
        assertPostMapping(controllerType, "latestVersionNotification", "/version/latest");
    }

    @Test
    void userNotificationPageAlwaysScopesQueryToCurrentUser() {
        NotificationService service = mock(NotificationService.class);
        NotificationController controller = new NotificationController();
        ReflectionTestUtils.setField(controller, "notificationService", service);
        when(service.queryManagePage(any(NotificationQueryDto.class))).thenReturn(new Page<>(1, 30));

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(10000057L);
        CurrentUserHolder.setLoginInfo(loginInfo);
        try {
            NotificationQueryDto query = new NotificationQueryDto();
            query.setTargetId(999L);
            query.setIsRead("0");

            controller.getNotificationListByPage(query);

            ArgumentCaptor<NotificationQueryDto> captor = ArgumentCaptor.forClass(NotificationQueryDto.class);
            verify(service).queryManagePage(captor.capture());
            assertThat(captor.getValue().getTargetId()).isEqualTo(10000057L);
            assertThat(captor.getValue().getIsRead()).isEqualTo("0");
        }
        finally {
            CurrentUserHolder.clearLoginInfo();
        }
    }

    private void assertPostMapping(Class<?> controllerType, String methodName, String path) {
        Method method = findMethod(controllerType, methodName);
        PostMapping mapping = method.getAnnotation(PostMapping.class);
        assertNotNull(mapping);
        assertArrayEquals(new String[] {path}, mapping.value());
    }

    private Method findMethod(Class<?> controllerType, String methodName) {
        for (Method method : controllerType.getDeclaredMethods()) {
            if (methodName.equals(method.getName())) {
                return method;
            }
        }
        throw new AssertionError("Missing method: " + methodName);
    }
}
