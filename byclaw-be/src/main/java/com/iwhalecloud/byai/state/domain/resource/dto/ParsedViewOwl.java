package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * OWL 视图解析结果。
 */
@Getter
@Setter
public class ParsedViewOwl {

    private String resourceCode;

    private String resourceName;

    private String resourceDesc;

    private String resourceVersionId;

    private String resourceBizType;

    private String sourceContent;

    private List<String> objectCodes = new ArrayList<>();

    private List<ParsedViewFieldRef> fieldRefs = new ArrayList<>();

    private List<ParsedViewField> fields = new ArrayList<>();
}
