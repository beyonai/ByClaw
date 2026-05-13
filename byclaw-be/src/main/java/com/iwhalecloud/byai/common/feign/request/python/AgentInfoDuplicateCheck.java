package com.iwhalecloud.byai.common.feign.request.python;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 数字员工信息（用于重复检查）
 */
@Getter
@Setter
public class AgentInfoDuplicateCheck {
    /**
     * 数字员工名称
     */
    private String name;

    /**
     * 核心能力
     */
    private List<CoreCompetency> coreCompetencies;

}
