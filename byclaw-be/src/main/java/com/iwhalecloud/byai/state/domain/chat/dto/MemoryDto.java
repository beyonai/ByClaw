package com.iwhalecloud.byai.state.domain.chat.dto;

import com.alibaba.fastjson.annotation.JSONField;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-01-15 19:49:41
 * @description TODO
 */
@Getter
@Setter
public class MemoryDto {

    @JSONField(name = "openMemory")
    private Boolean openMemory = false;
}
