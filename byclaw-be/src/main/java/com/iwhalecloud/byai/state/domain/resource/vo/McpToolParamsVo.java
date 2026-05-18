package com.iwhalecloud.byai.state.domain.resource.vo;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class McpToolParamsVo {

    private Long paramId;

    private Long mcpToolId;

    private String paramName;

    private String paramCode;

    private String paramType;

    private String paramDesc;

    private String defaultValue;

    private Boolean isRequired;

    private Object paramValue;
}
