package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * 单个资源包条目导入结果。
 */
@Getter
@Setter
public class ObjectZipImportItem {

    private Long catalogId;

    private String catalogName;

    private String resourceCode;

    private String resourceName;

    private String resourceDesc;

    private String resourceBizType;

    private String resourceId;

    private boolean updated;

    private boolean success;

    private String message;

    private String diffSummary;

    private List<ResourceImportDiffItem> diffDetails = new ArrayList<>();

    private java.util.List<String> missingObjectCodes = new java.util.ArrayList<>();
}
