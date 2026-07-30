package com.iwhalecloud.byai.manager.mapper.connector;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import org.apache.ibatis.annotations.Mapper;

/**
 * 用户连接器授权绑定 Mapper。
 */
@Mapper
public interface ConnectorAuthMapper extends BaseMapper<ConnectorAuth> {
}
