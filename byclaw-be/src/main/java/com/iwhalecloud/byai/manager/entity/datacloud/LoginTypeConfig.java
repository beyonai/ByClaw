package com.iwhalecloud.byai.manager.entity.datacloud;

import lombok.Data;

import java.util.Map;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/9/30 10:31
 */
@Data
public class LoginTypeConfig {

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

     private String authType;

     private String loginUrl;

     private String callBackUrl;

     private String paramPosition;

     private Map<String, String> authParams;
}
