package com.iwhalecloud.byai.manager.dto.ontology;

import java.util.List;
import lombok.Data;

/**
 * 绑定本体入参：把某本体库下选中的节点(叶子集合)覆盖式绑定到数字员工。
 *
 * @author qin.guoquan
 * @date 2026-07-04 14:38:38
 */
@Data
public class OntologyBindRequest {

    /** 目标数字员工资源 ID。 */
    private Long digitalEmployeeId;

    /** 资源归属类型：personal / enterprise。 */
    private String ownerType;

    /** 本体库编码（= ontologyBaseCode = ss_res_ext_ontology.pid）。 */
    private String baseId;

    /** 本体库名称（可选，展示/兜底用）。 */
    private String baseName;

    /** 选中的叶子节点集合。 */
    private List<OntologyBindNode> nodes;

    /**
     * 是否确认清空该本体在数字员工上的绑定。
     *
     * <p>nodes 为空时属于清空语义，必须显式传 true，避免前端未选择节点时误触发覆盖式清空。
     */
    private Boolean confirmClear;
}
