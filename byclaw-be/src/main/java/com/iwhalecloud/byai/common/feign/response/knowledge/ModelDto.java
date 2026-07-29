package com.iwhalecloud.byai.common.feign.response.knowledge;

import lombok.Getter;
import lombok.Setter;
import java.util.Map;

@Getter
@Setter
public class ModelDto {

    private String authToken;

    private String brandId;

    private Long createTime;

    private String createUser;

    private String instanceId;

    private String instanceMode;

    private String instanceName;

    private Map<String, Object> instanceParam;

    private String maxContentToken;

    private String modelCode;

    private String providerName;

    private String modelProtocol;

    private String modelName;

    private Integer status;

    private String subInstance;

    private String url;

    private Integer userCount;

    private String username;

    private String modelType;

    private Integer isDefault;

}
