package com.iwhalecloud.byai.manager.entity.ontology;

import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("ss_res_ext_ontology")
public class SsResExtOntology {

    private Long resourceId;

    //项目id
    private String pid;
}
