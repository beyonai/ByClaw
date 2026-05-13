package com.iwhalecloud.byai.manager.dto.pluginmodule;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class RegisterResponse {
    private Boolean success;
    private String message;
    private String employeeCode;
    private Long employeeId;
    private Boolean isNew;
}
