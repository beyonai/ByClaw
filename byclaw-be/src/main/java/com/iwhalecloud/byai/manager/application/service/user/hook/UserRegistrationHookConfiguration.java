package com.iwhalecloud.byai.manager.application.service.user.hook;

import com.iwhalecloud.byai.common.hook.HookEventSchema;
import java.util.Set;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Registration is distinct from administrative user creation and subsequent logins. */
@Configuration(proxyBeanMethods = false)
public class UserRegistrationHookConfiguration {
    @Bean
    public HookEventSchema userRegisteredHookSchema() {
        return new HookEventSchema("user.registered", 1, Set.of("userId", "displayName", "registrationSource"));
    }
}
