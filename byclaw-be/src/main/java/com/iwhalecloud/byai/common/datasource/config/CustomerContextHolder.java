package com.iwhalecloud.byai.common.datasource.config;

import com.alibaba.ttl.TransmittableThreadLocal;

/**
 * User: Simon
 * Date: 14-3-21
 */
public abstract class CustomerContextHolder {

    /**
     * 智能体数据源
     */
//    public static final  String DATA_SOURCE_AGENT = "AgentDataSource";
    /**
     * 百应数据源
     */
    public static final  String DATA_SOURCE_BYAI = "ByaiDataSource";
    public static final String DATA_SOURCE_SYSTEM = "dataSourceSystem";
    public static final String DATA_SOURCE_PHOENIX = "PhoenixDataSource";
    public static final String MYSQL = "mysql";
    public static final String ORACLE = "oracle";
    public static final String POSTGRESQL = "postgresql";

    private static final TransmittableThreadLocal<String> contextHolder = new TransmittableThreadLocal<String>();

    public static String getCustomerType() {
        return contextHolder.get();
    }

    public static void setCustomerType(String customerType) {
        contextHolder.set(customerType);
    }

    public static void clearCustomerType() {
        contextHolder.remove();
    }
}
