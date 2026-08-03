package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

class ConnectorControllerContractTest {

    @Test
    void exposesFrontendConnectionAndAuthorizationEndpoints() {
        assertThat(findMethod("listConnections").getAnnotation(GetMapping.class).value())
            .containsExactly("/connections");
        assertThat(findMethod("startAuthorization").getAnnotation(PostMapping.class).value())
            .containsExactly("/authorization/start");
        assertThat(findMethod("getAuthorizationStatus").getAnnotation(GetMapping.class).value())
            .containsExactly("/authorization/status");
    }

    private Method findMethod(String name) {
        return java.util.Arrays.stream(ConnectorController.class.getDeclaredMethods())
            .filter(method -> method.getName().equals(name))
            .findFirst()
            .orElseThrow();
    }
}
