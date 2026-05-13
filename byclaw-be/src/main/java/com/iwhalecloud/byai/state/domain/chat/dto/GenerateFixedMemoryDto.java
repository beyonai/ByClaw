package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-01-14 18:14:12
 * @description TODO
 */
@Getter
@Setter
public class GenerateFixedMemoryDto {

    private Long sessionId;

    private List<Long> messageIds;
}
