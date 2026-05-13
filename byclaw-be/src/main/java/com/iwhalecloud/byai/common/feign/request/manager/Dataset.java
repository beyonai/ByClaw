package com.iwhalecloud.byai.common.feign.request.manager;

import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

/**
 * @author he.duming
 * @date 2025-08-08 20:24:31
 * @description TODO
 */
@Getter
@Setter
public class Dataset implements Serializable {

    private Long datasetId;

    private String datasetCode;

    private String datasetName;

    private String datasetDesc;

    /**
     * 百应记录的知识库的属性
     */
    private Long resourceId;

    /**
     * 资源业务类型
     * 用于区KG_DOC还是KG_QA
     */
    private String resourceBizType;

}
