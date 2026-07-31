package com.iwhalecloud.byai.manager.mapper.connector;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 用户连接器授权绑定 Mapper。
 */
@Mapper
public interface ConnectorAuthMapper extends BaseMapper<ConnectorAuth> {

    /** 并发首次绑定时忽略有效授权唯一键冲突，避免 PostgreSQL 将外层事务置为 aborted。 */
    @Insert("""
        INSERT INTO byai_connector_auth (
            auth_id, user_id, connector_id, auth_name, auth_mode, auth_credential,
            expire_time, enable_flag, status_cd, last_sync_time, create_by, create_time, update_time
        ) VALUES (
            #{auth.authId}, #{auth.userId}, #{auth.connectorId}, #{auth.authName}, #{auth.authMode},
            #{auth.authCredential}, #{auth.expireTime}, #{auth.enableFlag}, #{auth.statusCd},
            #{auth.lastSyncTime}, #{auth.createBy}, #{auth.createTime}, #{auth.updateTime}
        )
        ON CONFLICT (user_id, connector_id) WHERE status_cd = '00A'
        DO NOTHING
        """)
    int insertActiveIgnoreConflict(@Param("auth") ConnectorAuth auth);
}
