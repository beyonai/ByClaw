package com.iwhalecloud.byai.state.domain.resource.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * 资源导入更新差异明细。
 * 用于在导入更新场景下，把更新前后的字段差异结构化返回给前端，
 * 便于前端展示摘要和表格化的对比详情。
 * @author qin.guoquan
 * @date 2026-04-24 10:40:00
 */
@Getter
@Setter
public class ResourceImportDiffItem {

    private String section;

    private String changeType;

    private String fieldCode;

    private String fieldName;

    private String beforeValue;

    private String afterValue;

    private String description;
}
