package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-08-10 13:49:20
 * @description TODO
 */
@Getter
@Setter
public class UpdateTaskStatusDto {

    private Long sessionId;

    private String taskStatus;
}
