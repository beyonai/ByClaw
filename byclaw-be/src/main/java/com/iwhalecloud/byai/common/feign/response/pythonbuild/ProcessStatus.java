package com.iwhalecloud.byai.common.feign.response.pythonbuild;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-04-23 19:16:41
 * @description TODO
 */
@Getter
@Setter
public class ProcessStatus {

    private String status;

    private String currentStep;

    private String currentStepStatus;

    private List<StatusDict> statusDict;

    private List<StepDict> stepDict;
}
