package com.iwhalecloud.byai.manager.dto.aimodel;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-06-30 20:49:59
 * @description TODO
 */
@Getter
@Setter
public class TokenSaver {

    private Boolean enabled;

    private String apiUrl;

    private String anthropicApiUrl;

    private String modelCode;

    private String accessToken;

    private String newApiUser;

    private String feignUrl;

}
