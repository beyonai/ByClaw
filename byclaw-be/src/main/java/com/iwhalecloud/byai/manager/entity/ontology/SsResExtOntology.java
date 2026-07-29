package com.iwhalecloud.byai.manager.entity.ontology;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("ss_res_ext_ontology")
public class SsResExtOntology {

    private Long resourceId;

    //项目id
    private String pid;

    /**
     * 来源内容：预留给后续本体导入（OWL/批量导入）的原始内容。
     */
    private String sourceContent;

    /**
     * 目标内容：本体实体的元数据明细 JSON 镜像（对象的属性/动作、视图的 objectCodes、场景/库的定位信息等），
     * 同时冗余 ownerType/baseId/sceneId/code 等 API 定位字段，供 Worker 运行期直接消费，避免反查。
     */
    private String targetContent;
}
