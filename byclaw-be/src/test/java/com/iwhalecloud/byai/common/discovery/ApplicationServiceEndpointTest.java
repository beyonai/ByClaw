package com.iwhalecloud.byai.common.discovery;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhaleai.byai.framework.core.discovery.ServiceInstance;
import com.iwhaleai.byai.framework.core.discovery.ServiceRegistry;

@ExtendWith(MockitoExtension.class)
class ApplicationServiceEndpointTest {

    @Mock
    private ServiceRegistry serviceRegistry;

    private ApplicationServiceEndpoint serviceEndpoint;

    @BeforeEach
    void setUp() {
        serviceEndpoint = new ApplicationServiceEndpoint(serviceRegistry);
        ReflectionTestUtils.setField(serviceEndpoint, "serviceName", "beclaw-be");
        ReflectionTestUtils.setField(serviceEndpoint, "discoveryHost", "192.168.0.83");
        ReflectionTestUtils.setField(serviceEndpoint, "actualServerPort", 8086);
        ReflectionTestUtils.setField(serviceEndpoint, "contextPath", "/byaiService");
    }

    @Test
    void registerUsesConfiguredEndpointIncludingContextPath() {
        Map<String, Object> metadata = Map.of("framework", "spring-boot");

        serviceEndpoint.register(metadata);

        verify(serviceRegistry).register("beclaw-be", "http", "192.168.0.83", 8086, "/byaiService", 1,
            metadata, 5);
    }

    @Test
    void getBaseUrlUsesTheCurrentRegisteredInstance() {
        ServiceInstance instance = ServiceInstance.builder()
            .protocol("http")
            .host("192.168.0.83")
            .port(8086)
            .pathPrefix("/byaiService")
            .build();
        when(serviceRegistry.getCurrentInstance()).thenReturn(instance);

        assertThat(serviceEndpoint.getBaseUrl()).isEqualTo("http://192.168.0.83:8086/byaiService");
    }

    @Test
    void registerLetsByFrameworkResolveAutoHost() {
        ReflectionTestUtils.setField(serviceEndpoint, "discoveryHost", "AUTO");

        serviceEndpoint.register(Map.of());

        verify(serviceRegistry).register("beclaw-be", "http", null, 8086, "/byaiService", 1, Map.of(), 5);
    }
}
