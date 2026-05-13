package com.iwhalecloud.byai.common.feign.request.python;

import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;

/**
 * 数字员工重复检查请求
 */
@Getter
@Setter
public class DigitalEmployeeDuplicateCheckRequest {

    /**
     * 待查重的数字员工信息
     */
    private AgentInfoDuplicateCheck agent;

    /**
     * 用户具有使用权限的数字员工ID列表
     */
    private List<String> agent_ids;

    /**
     * 环境变量
     */
    private Map<String, String> env;
}
