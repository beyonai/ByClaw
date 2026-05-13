package com.iwhalecloud.byai.state.domain.auth.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum MetaDataEnum {
    AGENT("AGENT", "智能体"),
    DATASET("DOC", "文档库"),
    DATABASE("DB", "数据库"),
    PLUG("PLUGIN", "插件"),
    CATALOGUE("CATALOGUE", "目录");
    //    ASS("超级助手", 6);
    String code;
    String name;
}
