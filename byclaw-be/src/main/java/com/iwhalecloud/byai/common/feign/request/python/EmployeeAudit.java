package com.iwhalecloud.byai.common.feign.request.python;

import lombok.Getter;
import lombok.Setter;
import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-10-29 18:27:46
 * @description 数字员工审核接口
 */
@Getter
@Setter
public class EmployeeAudit extends DigEmployeeExtCore {

    private String name;

    private List<CoreCompetency> coreCompetencies = new ArrayList<>();
}
