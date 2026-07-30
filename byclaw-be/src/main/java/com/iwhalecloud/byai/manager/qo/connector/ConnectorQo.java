package com.iwhalecloud.byai.manager.qo.connector;

import com.iwhalecloud.byai.common.qo.QueryObject;
import lombok.Getter;
import lombok.Setter;

/**
 * 连接器列表分页查询对象。
 */
@Getter
@Setter
public class ConnectorQo extends QueryObject {

    /** 当前用户ID（应用层注入，用于关联授权表） */
    private String userId;
}
