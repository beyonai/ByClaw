package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;

@Data
public class ScanSourceDTO {

    private Long sourceId;

    private Long projectId;

    private String sourceName;

    private String sourceType;

    private String config;

    private String cronExpr;

    private String enabled;
}
