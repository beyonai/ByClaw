package com.iwhalecloud.byai.common.feign.response.datacloud;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-05-25 18:35:22
 * @description TODO
 */
@Getter
@Setter
public class TermsOptionsResp {

    private List<TermsItem> items;

    private Integer page = 1;

    private Integer pageSize = 10;

    private Long total = 0L;
}
