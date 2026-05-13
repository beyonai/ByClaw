package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * OWL 对象字段定义。
 */
@Getter
@Setter
public class ParsedObjectField {

    private String propertyCode;

    private String propertyName;

    private String dataType;

    private String isRequired;

    private String defaultValue;

    private String sourceColumn;

    private String synonyms;

    private String dataFormat;

    private String measurementUnit;

    private String propertyCategory;

    private String propertyGroup;

    private String extProperty;

    private String termTypeCodePath;

    private String libraryCode;

    private String relAction;

    private String relTermCodeOrName;

    private String termDataType;

    private String sourceTableCode;

    private String sourceColumnCode;

    private String sourceDatasourceCode;
}
