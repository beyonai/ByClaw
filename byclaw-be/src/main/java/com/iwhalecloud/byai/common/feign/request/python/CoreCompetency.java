package com.iwhalecloud.byai.common.feign.request.python;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-12-22 11:40:53
 * @description TODO
 */
@Setter
@Getter
public class CoreCompetency {
    /**
     * 核心能力
     */
    private String coreCompetency;

    /**
     * 核心能力描述
     */
    private String description;

    /**
     * 接受边界
     */
    private List<String> acceptBoundary;

    /**
     * 拒绝边界
     */
    private List<String> rejectBoundary;

    /**
     * 样例数据
     */
    private List<String> example;

}
