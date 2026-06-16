package com.iwhalecloud.byai.state.interfaces.controller.ecosystem;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.lang.reflect.Method;

import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

class EcosystemCollectionIngestionControllerTest {

    @Test
    void exposesArtifactAndKnowledgeImportEndpoints() throws Exception {
        Class<?> controllerType = Class.forName(
            "com.iwhalecloud.byai.state.interfaces.controller.ecosystem.EcosystemCollectionIngestionController");

        assertNotNull(controllerType.getAnnotation(RestController.class));
        RequestMapping requestMapping = controllerType.getAnnotation(RequestMapping.class);
        assertArrayEquals(new String[] {"/ecosystemCollection/ingestion"}, requestMapping.value());

        assertPostMapping(controllerType, "storeArtifacts", "/artifacts/store");
        assertPostMapping(controllerType, "importMarkdown", "/knowledge/import");
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
