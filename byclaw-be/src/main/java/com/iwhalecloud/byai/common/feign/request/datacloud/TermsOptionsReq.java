package com.iwhalecloud.byai.common.feign.request.datacloud;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-05-25 18:33:10
 * @description TODO
 */
@Getter
@Setter
public class TermsOptionsReq {

    private String termSet;

    private String termTypeCode;

    private String termField;

    private String datasetId;

    private String keyword;

    private Integer page = 1;

    private Integer pageSize = 10;
}
