package com.iwhalecloud.byai.state.common.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@RequiredArgsConstructor
@Getter
public enum ResourceTypeEnum {
    /**
     * 智囊团
     */
    AGENT(1),

     //DATASET("2");
    /**
     *  文档库
     */
     DOC(2),

    /**
     *  插件
     */
    PLUGIN(3);

    private final Integer resourceType;
}
