package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;

import java.lang.reflect.Method;
import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.manager.dto.connector.CompleteSkillAuthorizationRequest;

class ConnectorControllerContractTest {

    @Test
    void exposesFrontendConnectionAndAuthorizationEndpoints() {
        assertThat(findMethod("listConnections").getAnnotation(GetMapping.class).value())
            .containsExactly("/connections");
        assertThat(findMethod("startAuthorization").getAnnotation(PostMapping.class).value())
            .containsExactly("/authorization/start");
        assertThat(findMethod("getAuthorizationStatus").getAnnotation(GetMapping.class).value())
            .containsExactly("/authorization/status");
        assertThat(findMethod("completeSkillAuthorization").getAnnotation(PostMapping.class).value())
            .containsExactly("/authorization/skill-complete");
    }

    @Test
    void skillCompletionRequestAcceptsOnlyConnectorCode() {
        assertThat(java.util.Arrays.stream(CompleteSkillAuthorizationRequest.class.getDeclaredFields())
            .map(Field::getName))
            .containsExactly("connectorCode");
    }

    private Method findMethod(String name) {
        return java.util.Arrays.stream(ConnectorController.class.getDeclaredMethods())
            .filter(method -> method.getName().equals(name))
            .findFirst()
            .orElseThrow();
    }
}
