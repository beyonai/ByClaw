package com.iwhalecloud.byai.manager.entity.datacloud;

import lombok.Data;

import java.io.Serializable;
import java.util.Map;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/9/28 13:55
 */
@Data
public class SyncAuthConfig implements Serializable {
    private static final long serialVersionUID = 1L;

    /**
     *  {
     *         "authType": "whale_plus",
     *         "loginUrl": "https://ssodr.iwhalecloud.com:40083/login/v2/auth/login?appKey=8cDkpta5yc03oeBrzeRl",
     *         "paramPosition": "url",
     *         "authParams": {
     *             "ssoCode": ""
     *         }
     *     }
     */

     private String auth_type;

     private String login_url;

     private String call_back_url;

     private String param_position;

     private Map<String, String> auth_params;
}
