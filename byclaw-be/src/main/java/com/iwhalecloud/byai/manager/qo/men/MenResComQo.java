package com.iwhalecloud.byai.manager.qo.men;

import com.iwhalecloud.byai.manager.entity.men.MenResCom;
import lombok.Data;

/**
 * 资源组件表
 */
@Data
public class MenResComQo extends MenResCom {
    /**
     * 消息id, 通知数字员工才需要传递
     */
    private Long messageId;

    /**
     * 任务 id, 通知数字员工才需要传递
     */
    private Long taskId;
}