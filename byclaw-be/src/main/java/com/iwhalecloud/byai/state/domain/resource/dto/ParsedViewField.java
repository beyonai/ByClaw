package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * OWL 视图字段定义。
 */
@Getter
@Setter
public class ParsedViewField {

    private String propertyCode;

    private String propertyName;

    private String sourceObjectCode;

    private String sourceObjectColumnCode;
}
