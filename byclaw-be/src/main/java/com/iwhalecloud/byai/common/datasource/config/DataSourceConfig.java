package com.iwhalecloud.byai.common.datasource.config;

import java.util.HashMap;
import java.util.Map;

import javax.sql.DataSource;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

/**
 * 多数据源配置
 *
 * @author yexihui
 */
@Configuration
public class DataSourceConfig {

    @Bean(name = "multipleDataSource")
    public MultipleDataSource getMultipleDataSource(@Qualifier("dataSourceByai") DataSource byai
//     , @Qualifier("dataSourceAgent") DataSource agent
    ) {
        MultipleDataSource multipleDataSource = new MultipleDataSource();
        multipleDataSource.setDefaultTargetDataSource(byai);
        Map<Object, Object> targetDataSources = new HashMap<>();
        targetDataSources.put(CustomerContextHolder.DATA_SOURCE_BYAI, byai);
//        targetDataSources.put(CustomerContextHolder.DATA_SOURCE_AGENT, agent);
        multipleDataSource.setTargetDataSources(targetDataSources);
        return multipleDataSource;
    }

    @Bean(name = "transactionManager")
    public DataSourceTransactionManager getTransactionManager(@Qualifier("multipleDataSource") DataSource multipleDataSource) {
        DataSourceTransactionManager dataSourceTransactionManager = new DataSourceTransactionManager();
        dataSourceTransactionManager.setDataSource(multipleDataSource);
        return dataSourceTransactionManager;
    }

}
