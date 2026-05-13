package com.iwhalecloud.byai.common.message.qo;

import lombok.Getter;
import lombok.Setter;

import java.util.Collection;

/**
 * @author he.duming
 * @date 2026-02-13 16:57:40
 * @description TODO
 */
@Getter
@Setter
public class AuAgentMetaQo {

    private Integer metaStatus;

    private String metaType;

    private Collection<String> metaIds;

}
