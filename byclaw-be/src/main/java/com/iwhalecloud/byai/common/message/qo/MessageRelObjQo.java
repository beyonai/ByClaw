package com.iwhalecloud.byai.common.message.qo;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2026-02-13 13:10:53
 * @description TODO
 */
@Getter
@Setter
public class MessageRelObjQo {

    /**
     * 消息标识
     */
    private Long messageId;

    /**
     * 任务ID列表
     */
    private List<Long> taskIds;

    /**
     * 提问消息ID列表
     */
    private List<String> askMsgIds;

    /**
     * 回复消息ID列表
     */
    private List<String> resMsgIds;
}
