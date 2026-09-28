package com.iwhalecloud.byai.manager.dto.digitemploy;

/**
 * @author qin.guoquan
 * @date 2026-09-27 22:38:38
 */

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class EmployeePublicationRequest {
    @NotNull
    private Long requestId;
    @NotNull
    private Long revision;
    private String comment;
    private DigitalEmployeeDTO employee;
}
