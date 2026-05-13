package com.iwhalecloud.byai.common.message.qo;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2026-02-09 21:53:24
 * @description TODO
 */
@Getter
@Setter
public class MessageHotPageQo {

    private Long sessionId;

    private Long creatorId;

    private Integer pageNum = 1;

    private Integer pageSize = 10;
}
