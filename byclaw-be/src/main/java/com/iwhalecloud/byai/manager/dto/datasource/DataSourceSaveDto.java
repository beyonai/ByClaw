package com.iwhalecloud.byai.manager.dto.datasource;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;
import java.util.Map;

@Getter
@Setter
public class DataSourceSaveDto {
    @NotNull
    private Long projectId;
    private Long datasourceId;
    @NotBlank @Size(max = 128)
    private String datasourceName;
    @Size(max = 2000)
    private String description;
    @NotBlank @Size(max = 32)
    private String datasourceType;
    @NotNull
    private Map<String, Object> connectionConfig;
    @com.alibaba.fastjson.annotation.JSONField(serialize = false)
    @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
    @Size(max = 4096)
    private String password;
}
