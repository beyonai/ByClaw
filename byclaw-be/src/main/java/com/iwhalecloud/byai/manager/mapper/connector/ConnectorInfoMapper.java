package com.iwhalecloud.byai.manager.mapper.connector;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorConnectionDto;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorListDto;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.qo.connector.ConnectorQo;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

/**
 * 连接器基础元信息 Mapper。
 */
@Mapper
public interface ConnectorInfoMapper extends BaseMapper<ConnectorInfo> {

    /**
     * 分页查询连接器列表（关联当前用户授权启用状态）。
     *
     * @param qo 查询条件
     * @return 连接器列表
     */
    List<ConnectorListDto> selectConnectorListByQo(@Param("qo") ConnectorQo qo,
        @Param("userId") String userId);

    ConnectorInfo selectByConnectorCode(@Param("connectorCode") String connectorCode);

    List<ConnectorInfo> selectAccountTemplatesForUpdate();

    List<ConnectorConnectionDto> selectConnectionsByUserId(@Param("userId") String userId);
}
