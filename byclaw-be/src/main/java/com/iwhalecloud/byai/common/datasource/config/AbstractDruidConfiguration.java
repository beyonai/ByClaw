package com.iwhalecloud.byai.common.datasource.config;

import java.util.ArrayList;
import java.util.List;
import javax.naming.NamingException;
import javax.sql.DataSource;

import com.iwhalecloud.byai.common.ecrypt.RsaDecrypt;
import org.apache.commons.lang3.StringUtils;
import org.springframework.boot.jdbc.DatabaseDriver;
import org.springframework.context.annotation.Bean;
import org.springframework.jndi.JndiObjectFactoryBean;
import com.alibaba.druid.filter.Filter;
import com.alibaba.druid.pool.DruidDataSource;
import com.alibaba.druid.pool.vendor.PGValidConnectionChecker;
import com.alibaba.druid.wall.WallConfig;
import com.alibaba.druid.wall.WallFilter;
import com.iwhalecloud.byai.common.datasource.properties.AbstractDruidProperties;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public abstract class AbstractDruidConfiguration {

    protected abstract AbstractDruidProperties getDruidProperties();

    public DataSource dataSourceManager(AbstractDruidProperties druidProperties) throws NamingException {
        if (druidProperties.getType().equals("jndi")) {
            JndiObjectFactoryBean bean = new JndiObjectFactoryBean();
            bean.setJndiName(druidProperties.getJndiName());
            bean.setProxyInterface(DataSource.class);
            bean.setLookupOnStartup(false);
            bean.afterPropertiesSet();
            return (DataSource) bean.getObject();
        }
        DruidDataSource dataSource = new DruidDataSource();
        // 设置驱动，账号和密码
        dataSource.setDriverClassName(druidProperties.getDriverClassName());
        dataSource.setUrl(druidProperties.getUrl());
        dataSource.setUsername(druidProperties.getUsername());
        if (druidProperties.isEncrypt()) {
            dataSource.setPassword(RsaDecrypt.decrypt(druidProperties.getPassword()));
        } else {
            dataSource.setPassword(druidProperties.getPassword());
        }
        // 设置连接池相关参数
        dataSource.setKeepAlive(true);
        dataSource.setInitialSize(druidProperties.getInitialSize());
        dataSource.setMinIdle(druidProperties.getMinIdle());
        dataSource.setMaxActive(druidProperties.getMaxActive());
        dataSource.setMaxWait(druidProperties.getMaxWait());

        // 设置保活相关
        dataSource.setTimeBetweenEvictionRunsMillis(druidProperties.getTimeBetweenEvictionRunsMillis());
        dataSource.setMinEvictableIdleTimeMillis(druidProperties.getMinEvictableIdleTimeMillis());
        dataSource.setMaxEvictableIdleTimeMillis(druidProperties.getMaxEvictableIdleTimeMillis());
        dataSource.setTestWhileIdle(druidProperties.isTestWhileIdle());
        dataSource.setTestOnBorrow(druidProperties.isTestOnBorrow());
        dataSource.setTestOnReturn(druidProperties.isTestOnReturn());
        dataSource.setDefaultAutoCommit(druidProperties.isDefaultAutoCommit());
        dataSource.setKeepAliveBetweenTimeMillis(druidProperties.getKeepAliveBetweenTimeMillis());

        DatabaseDriver databaseDriver = DatabaseDriver.fromJdbcUrl(druidProperties.getUrl());
        String validationQuery = databaseDriver.getValidationQuery();
        if (StringUtils.isNotBlank(validationQuery)) {
            dataSource.setTestOnBorrow(true);
            dataSource.setValidationQuery(validationQuery);
        }

        String dbType = druidProperties.getDbType();
        if (StringUtils.isNotEmpty(dbType)
                && !"udal".equalsIgnoreCase(dbType)
                && !"teledb".equalsIgnoreCase(dbType)) {
            dataSource.setDbType(dbType);
        }

        if (StringUtils.containsIgnoreCase(druidProperties.getUrl(), "jdbc:opengauss:")) {
            dataSource.setDbType("postgresql");
            dataSource.setValidConnectionChecker(new PGValidConnectionChecker());
        }

        // 批量更新报错，坑爹的覆盖，坑坑坑坑sql injection violation, multi-statement not allow，
        List<Filter> filterList = new ArrayList<Filter>();
        filterList.add(wallFilter());
        dataSource.setProxyFilters(filterList);

        try {
            // 开启Druid的监控统计功能，mergeStat代替stat表示sql合并,wall表示防御SQL注入攻击
            dataSource.setFilters(druidProperties.getFilters());
        } catch (Exception e) {
            log.error(e.getMessage(), e);
        }

        log.info(druidProperties.toString());
        return dataSource;
    }

    @Bean
    public WallFilter wallFilter() {
        WallFilter wallFilter = new WallFilter();
        wallFilter.setConfig(wallConfig());
        return wallFilter;
    }

    @Bean
    public WallConfig wallConfig() {
        WallConfig config = new WallConfig();
        // 允许一次执行多条语句
        config.setMultiStatementAllow(true);
        // 允许非基本语句的其他语句
        config.setNoneBaseStatementAllow(true);
        return config;
    }

}