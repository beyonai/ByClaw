package com.iwhalecloud.byai.state.domain.chat.dto;

import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRelObjDto;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-01-15 00:18:24
 * @description TODO
 */
@Getter
@Setter
public class GenerateFixedMemoryGroup {

    private ByaiMessageHotDto input;

    private List<ByaiMessageHotDto> outputs;

    private List<ByaiMessageRelObjDto> messageRelObjDtos;

    public GenerateFixedMemoryGroup() {
        this.outputs = new ArrayList<>();
        this.messageRelObjDtos = new ArrayList<>();
    }

}
