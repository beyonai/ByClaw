package com.iwhalecloud.byai.state.domain.resource.vo;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class McpToolsVo {

    private Long mcpToolId;

    private String toolCode;

    private String toolComments;

    private String mcpServerUrl;

    private String mcpType;

    private String mcpHeader;

    public List<McpToolParamsVo> toolParamsList;
}
