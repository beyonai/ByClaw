package com.iwhalecloud.byai.manager.dto.ontology;

import lombok.Data;

/**
 * 数字员工本体资源关系请求。
 *
 * @author qin.guoquan
 * @date 2026-07-04 14:38:38
 */
@Data
public class OntologyBindRequest {

    /** 目标数字员工资源 ID。 */
    private Long digitalEmployeeId;

    /** 单节点解绑时的目标本体资源 ID（视图/对象/场景/库）。 */
    private Long relResourceId;
}
