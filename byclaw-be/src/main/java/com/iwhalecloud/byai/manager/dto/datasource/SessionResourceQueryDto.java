package com.iwhalecloud.byai.manager.dto.datasource;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SessionResourceQueryDto {
    @NotNull
    private Long sessionId;
    @NotBlank @Size(max = 32)
    private String resourceType;
    private Long resourceId;
    @Size(max = 200)
    private String keyword;
    @Size(max = 32)
    private String datasourceType;
    @Min(1) @Max(1000000)
    private int pageNum = 1;
    @Min(1) @Max(100)
    private int pageSize = 50;
    private boolean includeCredentials;

    public long offset() {
        return (long) (pageNum - 1) * pageSize;
    }
}
