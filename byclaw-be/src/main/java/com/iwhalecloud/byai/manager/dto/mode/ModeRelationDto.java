package com.iwhalecloud.byai.manager.dto.mode;


import com.iwhalecloud.byai.manager.entity.mode.ByaiModeDigRel;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class ModeRelationDto extends ByaiModeDigRel {

    private String resourceName;
}
