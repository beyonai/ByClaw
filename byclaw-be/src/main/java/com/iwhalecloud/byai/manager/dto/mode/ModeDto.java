package com.iwhalecloud.byai.manager.dto.mode;

import com.iwhalecloud.byai.manager.entity.mode.ByaiMode;
import java.util.List;
import lombok.Getter;
import lombok.Setter;

@Setter
@Getter
public class ModeDto extends ByaiMode {

    private List<ModeRelationDto> relations;
}
