package com.iwhalecloud.byai.manager.vo.digitemploy;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-04-20 17:32:35
 * @description TODO
 */
@Getter
@Setter
public class DebugSessionVo {

    /**
     * 会话信息
     */
    private ByaiSession sessionInfo;

    /**
     * 消息记录列表（最多1000条）
     */
    private List<ByaiMessage> messages;

    /**
     * 消息总数
     */
    private long totalMessageCount;
}
