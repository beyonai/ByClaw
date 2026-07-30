package com.iwhalecloud.byai.manager.domain.connector.service;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 用户连接器授权绑定领域服务。
 */
@Service
public class ConnectorAuthService {

    @Autowired
    private ConnectorAuthMapper connectorAuthMapper;

    /**
     * 新增用户连接器授权记录。
     *
     * @param connectorAuth 授权实体
     */
    public void save(ConnectorAuth connectorAuth) {
        connectorAuthMapper.insert(connectorAuth);
    }

    /**
     * 按主键更新用户连接器授权记录。
     *
     * @param connectorAuth 授权实体
     */
    public void update(ConnectorAuth connectorAuth) {
        connectorAuthMapper.updateById(connectorAuth);
    }

    /**
     * 按主键查询用户连接器授权记录。
     *
     * @param authId 授权记录ID
     * @return 授权实体，不存在时返回 null
     */
    public ConnectorAuth findById(Long authId) {
        return connectorAuthMapper.selectById(authId);
    }
}
