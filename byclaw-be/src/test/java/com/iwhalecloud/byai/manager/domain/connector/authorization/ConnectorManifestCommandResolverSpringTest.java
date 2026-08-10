package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer;

class ConnectorManifestCommandResolverSpringTest {

    @Test
    void springSelectsProductionConstructorWhenTestConstructorAlsoExists() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getBeanFactory().registerSingleton("objectMapper", new ObjectMapper());
            context.registerBean(ConnectorManifestCanonicalizer.class);
            context.registerBean(ConnectorManifestCommandResolver.class);

            context.refresh();

            assertThat(context.getBean(ConnectorManifestCommandResolver.class)).isNotNull();
        }
    }
}
