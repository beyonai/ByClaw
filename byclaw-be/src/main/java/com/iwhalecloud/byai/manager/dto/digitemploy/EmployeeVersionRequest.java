package com.iwhalecloud.byai.manager.dto.digitemploy;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class EmployeeVersionRequest {
    @NotNull private Long resourceId;
    private Long versionId;
    private Long baseVersionId;
    private Long expectedRevision;
    @Size(max = 64) private String requestId;
    @Size(max = 500) private String note;
    private boolean activate = true;
    private DigitalEmployeeDTO employee;
}
