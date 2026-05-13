package com.iwhalecloud.byai.state.database;

import javax.naming.NamingException;
import javax.sql.DataSource;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import com.iwhalecloud.byai.common.datasource.config.AbstractDruidConfiguration;
import com.iwhalecloud.byai.common.datasource.properties.AbstractDruidProperties;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;

@Configuration
@Slf4j
public class ByaiConfiguration extends AbstractDruidConfiguration {
    @Resource
    ByaiDruidProperties byaiDruidProperties;


    @Override
    protected AbstractDruidProperties getDruidProperties() {
        return byaiDruidProperties;
    }

    @Bean(name = "dataSourceByai")
    @Conditional(ByaiDruidProperties.class)
    @Qualifier("dataSourceByai")
    @Primary
    public DataSource dataSourceByai() throws NamingException {
        return dataSourceManager(byaiDruidProperties);
    }
}
