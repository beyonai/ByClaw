package com.iwhalecloud.byai.manager.dto.datasource;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DataSourceScopeDto {
    @NotNull
    private Long projectId;
    private Long datasourceId;
}
