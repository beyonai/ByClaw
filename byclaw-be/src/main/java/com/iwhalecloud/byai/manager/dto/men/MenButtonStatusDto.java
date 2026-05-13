package com.iwhalecloud.byai.manager.dto.men;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-01-26 11:11:20
 * @description TODO
 */
@Getter
@Setter
public class MenButtonStatusDto {

    private String taskExtId;

    private String systemNo;

    private List<ButtonStatusDto> buttonStatus;
}
