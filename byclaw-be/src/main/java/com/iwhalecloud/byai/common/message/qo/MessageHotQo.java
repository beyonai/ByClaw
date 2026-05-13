package com.iwhalecloud.byai.common.message.qo;

import lombok.Getter;
import lombok.Setter;

import java.util.Collection;

/**
 * @author he.duming
 * @date 2026-02-13 14:23:42
 * @description TODO
 */
@Getter
@Setter
public class MessageHotQo {

    private Integer topK;

    private String keyword;

    private Long sessionId;

    private Long creatorId;

    private Collection<Long> messageIds;




}
