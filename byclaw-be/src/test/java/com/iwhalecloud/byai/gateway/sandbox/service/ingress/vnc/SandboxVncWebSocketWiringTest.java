package com.iwhalecloud.byai.gateway.sandbox.service.ingress.vnc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockServletContext;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.handler.MappedInterceptor;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import com.iwhalecloud.byai.manager.domain.tenant.TenantContextInterceptor;
import com.iwhalecloud.byai.state.infrastructure.filter.AccessTokenVerifyInterceptor;
import com.iwhalecloud.byai.state.infrastructure.filter.WebMvcConfiguration;

class SandboxVncWebSocketWiringTest {
    @Test void springResolvesBothAuthenticationBeansAndReusesMvcInterceptors() throws Exception {
        try (var context = new AnnotationConfigWebApplicationContext()) {
            context.setServletContext(new MockServletContext());
            // Keep both real production bean names. Dependencies are isolated, while Spring
            // performs the real @Bean method argument resolution and HandlerMapping lifecycle.
            context.addBeanFactoryPostProcessor(factory -> {
                factory.registerSingleton("accessTokenVerifyInterceptor", mock(AccessTokenVerifyInterceptor.class));
                factory.registerSingleton("tokenVerifyInterceptor", mock(AccessTokenVerifyInterceptor.class));
                factory.registerSingleton("tenantContextInterceptor", mock(TenantContextInterceptor.class));
                factory.registerSingleton("jacksonBuilder", new Jackson2ObjectMapperBuilder());
                factory.registerSingleton("sandboxVncTargetResolver", mock(SandboxVncTargetResolver.class));
                factory.registerSingleton("sandboxVncWebSocketHandler", new SandboxVncWebSocketHandler());
            });
            context.register(WebMvcConfiguration.class, SandboxVncWebSocketConfig.class,
                AccessTokenVerifyInterceptor.class, TenantContextInterceptor.class);
            context.refresh();

            assertThat(context.getBeansOfType(AccessTokenVerifyInterceptor.class))
                .containsOnlyKeys("accessTokenVerifyInterceptor", "tokenVerifyInterceptor");
            assertThat(context.getBeansOfType(TenantContextInterceptor.class))
                .containsOnlyKeys("tenantContextInterceptor");
            var auth = context.getBean("tokenVerifyInterceptor", AccessTokenVerifyInterceptor.class);
            var tenant = context.getBean("tenantContextInterceptor", TenantContextInterceptor.class);
            var registry = new InterceptorRegistry();
            context.getBean(WebMvcConfiguration.class).addInterceptors(registry);
            List<HandlerInterceptor> mvc = ReflectionTestUtils.invokeMethod(registry, "getInterceptors");
            assertThat(mvc.stream().map(i -> ((MappedInterceptor) i).getInterceptor()))
                .containsExactly(auth, tenant);

            var request = new MockHttpServletRequest("GET", "/sandbox/vnc/session/vnc/websockify");
            request.addHeader("Upgrade", "websocket");
            var mapping = context.getBean("sandboxVncWebSocketMapping", SimpleUrlHandlerMapping.class);
            var chain = mapping.getHandler(request);
            assertThat(chain).isNotNull();
            assertThat(chain.getInterceptors()).contains(auth, tenant)
                .doesNotContain(context.getBean("accessTokenVerifyInterceptor", AccessTokenVerifyInterceptor.class));
        }
    }
}
