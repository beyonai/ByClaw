package com.iwhalecloud.byai.state.domain.message.model;

import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-02-13 16:43:16
 * @description TODO
 */
@Getter
@Setter
public class ForwardMessageDtoDto extends ByaiMessageHotDto {

    private List<ByaiMessageHotDto> forwardMsgList;
}
