package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * OWL 对象解析结果。
 */
@Getter
@Setter
public class ParsedObjectOwl {

    private String resourceCode;

    private String resourceName;

    private String resourceDesc;

    private String resourceVersionId;

    private String resourceBizType;

    private String sourceContent;

    private String entitySource;

    private List<ParsedObjectField> fields = new ArrayList<>();
}
