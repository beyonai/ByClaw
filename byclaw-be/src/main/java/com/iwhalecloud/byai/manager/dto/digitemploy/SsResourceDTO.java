package com.iwhalecloud.byai.manager.dto.digitemploy;

import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import lombok.Data;

/**
 * @author cxf
 * @description: TODO
 * @date 2025/12/12 14:14
 */
@Data
public class SsResourceDTO extends SsResource {

    /**
     * 关联资源信息
     */
    private String relResourceInfo;

    /**
     * 关联可用资源数量
     */
    private Integer activeResourceNum;


    private Long relDetailId;

    private Long relResourceId;

    /**
     * 所属本体库编码：仅 resourceBizType 为 ONTOLOGY_BASE/SCENE/VIEW/OBJECT 的本体类资源填充，
     * 取自 ss_res_ext_ontology.pid，供运行期识别本体归属。
     */
    private String ontologyBaseCode;
}
