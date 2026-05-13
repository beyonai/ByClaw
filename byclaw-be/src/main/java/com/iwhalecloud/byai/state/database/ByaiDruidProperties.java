package com.iwhalecloud.byai.state.database;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.datasource.properties.AbstractDruidProperties;

@Component
@ConfigurationProperties(prefix = "spring.datasource.byai")
public class ByaiDruidProperties extends AbstractDruidProperties implements Condition {

    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String url = context.getEnvironment().getProperty("spring.datasource.byai.url");
        String type = context.getEnvironment().getProperty("spring.datasource.byai.type");
        if ("jndi".equals(type)) {
            return true;
        }

        if (url == null) {
            return false;
        }
        return true;
    }

}

