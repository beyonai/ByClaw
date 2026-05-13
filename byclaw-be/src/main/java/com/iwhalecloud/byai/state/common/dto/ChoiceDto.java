package com.iwhalecloud.byai.state.common.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ChoiceDto {

    private String finish_reason;

    private DeltaDto delta;

    private String index;

}
