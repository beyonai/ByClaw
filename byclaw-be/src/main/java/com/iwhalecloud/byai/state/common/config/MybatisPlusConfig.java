package com.iwhalecloud.byai.state.common.config;

import java.util.Properties;

import org.apache.ibatis.mapping.DatabaseIdProvider;
import org.apache.ibatis.mapping.VendorDatabaseIdProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;

/**
 * mybatis-plus配置
 */

@Configuration
public class MybatisPlusConfig {

    @Value("${spring.datasource.bymanger.dbType:postgresql}")
    private String dbType;

    /**
     * 分页增强
     *
     * @return MybatisPlusInterceptor
     */
    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

        PaginationInnerInterceptor paginationInnerInterceptor;

        if ("postgresql".equalsIgnoreCase(dbType)) {
            paginationInnerInterceptor = new PaginationInnerInterceptor(DbType.POSTGRE_SQL);
        }
        else {
            paginationInnerInterceptor = new PaginationInnerInterceptor(DbType.MYSQL);

        }
        // 溢出总页数后是否进行处理
        // paginationInnerInterceptor.setOverflow(true);

        interceptor.addInnerInterceptor(paginationInnerInterceptor);

        return interceptor;
    }

    /**
     * 注数据厂商名name不可修改，与厂商驱动包DatabaseMetaData的getDatabaseProductName值对应，更改后将不可用
     * 
     * @return DatabaseIdProvider
     */
    @Bean
    public DatabaseIdProvider databaseIdProvider() {
        VendorDatabaseIdProvider databaseIdProvider = new VendorDatabaseIdProvider();
        Properties properties = new Properties();
        properties.setProperty("MySQL", DbType.MYSQL.getDb());
        properties.setProperty("PostgreSQL", DbType.POSTGRE_SQL.getDb());
        databaseIdProvider.setProperties(properties);
        return databaseIdProvider;
    }
}