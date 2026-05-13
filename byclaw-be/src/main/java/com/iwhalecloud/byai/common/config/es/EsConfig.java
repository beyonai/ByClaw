package com.iwhalecloud.byai.common.config.es;

import lombok.Data;

@Data
public class EsConfig {

    private String version;

    private String hosts;

    /**
     * MD5加密
     */
    private String username;

    /**
     * MD5加密
     */
    private String password;
}
