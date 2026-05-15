package com.iwhalecloud.byai.common.feign.request.sandbox;

import java.util.Map;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class WhaleAgentListSandboxesRequest {

    private Integer page;

    private Integer pageSize;

    private Map<String, String> metadata;
}
