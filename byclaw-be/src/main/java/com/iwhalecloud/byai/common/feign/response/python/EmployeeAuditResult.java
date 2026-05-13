package com.iwhalecloud.byai.common.feign.response.python;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-10-29 18:17:21
 * @description TODO
 */
@Getter
@Setter
public class EmployeeAuditResult {

    private String key;

    private Boolean compliance = true;

    private String reason;

    private List<EmployeeAuditResult> subItems;

}
