package com.iwhalecloud.byai.state.domain.message.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum PraiseAndTreadEnum {
    // praise点赞
    // tread 点踩
    /**
     * 点赞
     * */
    PRAISE("praise"),
    /**
     *点踩
     * */
    TREAD("tread"),
    /**
     *无
     * */
    None("none");


    /**
     * 行为类型
     * */
    private String type;


    /**
     * 获得当前行为的名称
     * 点赞/点踩
     * */
    public static PraiseAndTreadEnum getName(String type) {
        for (PraiseAndTreadEnum item : PraiseAndTreadEnum.values()) {
            if (item.getType().equalsIgnoreCase(type)) {
                return item;
            }
        }
        return null;
    }
}
