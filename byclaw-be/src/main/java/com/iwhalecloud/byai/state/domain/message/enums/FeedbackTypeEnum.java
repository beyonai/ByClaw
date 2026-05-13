package com.iwhalecloud.byai.state.domain.message.enums;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum FeedbackTypeEnum {
    /**
     * 反馈类型 - 答案不准确
     * */
    ANS_INACCURATE("ANS_INACCURATE"),
    /**
     * 反馈类型 - 找错人
     * */
    WRONG_PERSON("WRONG_PERSON"),
    /**
     * 反馈类型 - 其他
     * */
    FEED_OTHER("FEED_OTHER");


    /**
     * 行为类型
     * */
    private String type;


    /**
     * 获得当前行为的名称
     * */
    public static FeedbackTypeEnum getName(String type) {
        for (FeedbackTypeEnum item : FeedbackTypeEnum.values()) {
            if (item.getType().equalsIgnoreCase(type)) {
                return item;
            }
        }
        return null;
    }
}
