package com.iwhalecloud.byai.manager.dto.operations;

import jakarta.validation.constraints.NotBlank;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;

/**
 * 运营看板查询请求DTO
 * 
 * @author ByAI Team
 * @date 2025-10-30
 */
@Getter
@Setter
public class OperationsQueryRequest {

    /**
     * 查询编码，对应query_config表中的query_code
     */
    @NotBlank(message = "查询编码不能为空")
    private String queryCode;


    /**
     * 额外查询参数，用于动态SQL参数替换
     * 例如：{"orgId": "123", "agentId": "456"}
     */
    private Map<String, Object> params;


}


