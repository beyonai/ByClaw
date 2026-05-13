package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-01-13 17:53:55
 * @description TODO
 */
@Getter
@Setter
public class ModelInfoDto {

    private String model;

    private Long modelId;

    private Long history;

    private Double temperature;

    private Long maxToken;

}
