package com.iwhalecloud.byai.manager.dto.searchask;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-03-11 17:32:57
 * @description TODO
 */
@Getter
@Setter
public class SelectedDto {

    private Long sessionId;

    private String dirType;

    private List<SpaceDataDto> spaceDataList;

    private Long agentId;
}
