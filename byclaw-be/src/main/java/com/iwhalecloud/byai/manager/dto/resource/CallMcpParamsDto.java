package com.iwhalecloud.byai.manager.dto.resource;

import lombok.Getter;
import lombok.Setter;

import java.util.Map;

/**
 * @author he.duming
 * @date 2026-05-18 16:30:48
 * @description TODO
 */
@Getter
@Setter
public class CallMcpParamsDto {

    private Long resourceId;

    private String name;

    private Map<String, Object> arguments;
}
