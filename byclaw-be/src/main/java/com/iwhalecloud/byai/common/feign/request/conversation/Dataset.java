package com.iwhalecloud.byai.common.feign.request.conversation;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-08-08 20:24:31
 * @description TODO
 */
@Getter
@Setter
public class Dataset {

    /**
     * 百应记录的知识库的属性
     */
    private Long resourceId;

    private String resourceBizType;

    private Long datasetId;

    private String datasetCode;

    private String datasetName;

    private String datasetDesc;
}
