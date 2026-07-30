package com.iwhalecloud.byai.manager.domain.connector.service;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorListDto;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import com.iwhalecloud.byai.manager.qo.connector.ConnectorQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 连接器基础元信息领域服务。
 */
@Service
public class ConnectorInfoService {

    @Autowired
    private ConnectorInfoMapper connectorInfoMapper;

    /**
     * 分页查询连接器列表（含当前用户启用状态）。
     *
     * @param qo 查询条件
     * @return 分页结果
     */
    public PageInfo<ConnectorListDto> listAll(ConnectorQo qo) {
        Page<ConnectorListDto> page = PageHelper.startPage(qo.getPageNum(), qo.getPageSize());
        connectorInfoMapper.selectConnectorListByQo(qo);
        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 新增连接器元信息。
     *
     * @param connectorInfo 连接器实体
     */
    public void save(ConnectorInfo connectorInfo) {
        connectorInfoMapper.insert(connectorInfo);
    }

    /**
     * 按主键更新连接器元信息。
     *
     * @param connectorInfo 连接器实体
     */
    public void update(ConnectorInfo connectorInfo) {
        connectorInfoMapper.updateById(connectorInfo);
    }

    /**
     * 按主键查询连接器元信息。
     *
     * @param connectorId 连接器ID
     * @return 连接器实体，不存在时返回 null
     */
    public ConnectorInfo findById(Long connectorId) {
        return connectorInfoMapper.selectById(connectorId);
    }
}
