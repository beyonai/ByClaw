package com.iwhalecloud.byai.common.constants.resource;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Getter
public enum ResourceHostType {
    HOSTED("hosted", "远程"),
    LOCAL("local", "本地");

    private final String code;
    private final String desc;
}
