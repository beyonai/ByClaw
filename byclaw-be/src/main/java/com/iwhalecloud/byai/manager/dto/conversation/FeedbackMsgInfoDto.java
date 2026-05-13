package com.iwhalecloud.byai.manager.dto.conversation;

import com.iwhalecloud.byai.manager.entity.conversation.FeedbackMsgInfo;
import lombok.Getter;
import lombok.Setter;
import lombok.EqualsAndHashCode;

/**
 * FeedbackMsgInfo的扩展类 存储指派人和处理人信息
 */
@Getter
@Setter
@EqualsAndHashCode(callSuper = true)
public class FeedbackMsgInfoDto extends FeedbackMsgInfo {
    /**
     * 指派人名称
     */
    private String assignerName;
    /**
    * 处理人名称
    */
    private String handlerName;

}
