package com.iwhalecloud.byai.common.feign.response.datacloud;

import lombok.Getter;
import lombok.Setter;

import java.util.Map;

/**
 * @author he.duming
 * @date 2026-05-25 18:37:40
 * @description TODO
 */
@Getter
@Setter
public class TermsItem {

    private String label;

    private String value;

    private String code;

    private String name;

    private Map<String, Object> metadata;
}
