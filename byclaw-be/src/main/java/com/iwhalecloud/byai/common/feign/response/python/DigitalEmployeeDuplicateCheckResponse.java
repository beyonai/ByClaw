package com.iwhalecloud.byai.common.feign.response.python;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 数字员工重复检查响应
 */
@Getter
@Setter
public class DigitalEmployeeDuplicateCheckResponse {

    /**
     * 重复的数字员工ID列表
     */
    private List<String> duplicate_agents;
}


