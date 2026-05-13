package com.iwhalecloud.byai.state.common.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class DeltaDto {

    private String content;

    public DeltaDto() {
    }

    public DeltaDto(String content) {
        this.content = content;
    }

}
