package com.iwhalecloud.byai.state.interfaces.controller.notification;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.lang.reflect.Method;

import org.junit.jupiter.api.Test;
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

        assertPostMapping(controllerType, "managePage", "/manage/page");
        assertPostMapping(controllerType, "manageDetail", "/manage/detail");
        assertPostMapping(controllerType, "manageCreate", "/manage/create");
        assertPostMapping(controllerType, "manageUpdate", "/manage/update");
        assertPostMapping(controllerType, "manageDelete", "/manage/delete");
        assertPostMapping(controllerType, "latestVersionNotification", "/version/latest");
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
