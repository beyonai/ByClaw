package com.iwhalecloud.byai.manager.mapper.connector;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorEnableStateDto;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * 用户连接器授权绑定 Mapper。
 */
@Mapper
public interface ConnectorAuthMapper extends BaseMapper<ConnectorAuth> {

    /** 查询指定用户已授权连接器及其开启状态。 */
    @Select("""
        SELECT info.connector_code,
               info.skill_code,
               CASE WHEN auth.enable_flag = 'Y' THEN TRUE ELSE FALSE END AS enabled
        FROM byai_connector_info info
        INNER JOIN (
            SELECT connector_id, enable_flag
            FROM (
                SELECT connector_id,
                       enable_flag,
                       ROW_NUMBER() OVER (
                           PARTITION BY connector_id
                           ORDER BY CASE WHEN enable_flag = 'Y' THEN 0 ELSE 1 END,
                                    update_time DESC NULLS LAST,
                                    create_time DESC,
                                    auth_id DESC
                       ) AS row_num
                FROM byai_connector_auth
                WHERE user_id = #{userId}
                  AND status_cd = '00A'
            ) ranked
            WHERE row_num = 1
        ) auth ON auth.connector_id = info.connector_id
        WHERE info.status_cd = '00A'
        ORDER BY info.sort ASC, info.connector_id ASC
        """)
    List<ConnectorEnableStateDto> selectConnectorEnableStates(@Param("userId") String userId);

    /** 并发首次绑定时忽略有效授权唯一键冲突，兼容 openGauss。 */
    @Insert("""
        MERGE INTO byai_connector_auth target
        USING (
            SELECT
                #{auth.authId} AS auth_id,
                #{auth.userId} AS user_id,
                #{auth.connectorId} AS connector_id,
                #{auth.authName} AS auth_name,
                #{auth.authMode} AS auth_mode,
                #{auth.authCredential} AS auth_credential,
                #{auth.expireTime} AS expire_time,
                #{auth.enableFlag} AS enable_flag,
                #{auth.statusCd} AS status_cd,
                #{auth.lastSyncTime} AS last_sync_time,
                #{auth.createBy} AS create_by,
                #{auth.createTime} AS create_time,
                #{auth.updateTime} AS update_time
        ) source
        ON (
            target.user_id = source.user_id
            AND target.connector_id = source.connector_id
            AND target.status_cd = '00A'
        )
        WHEN NOT MATCHED THEN INSERT (
            auth_id, user_id, connector_id, auth_name, auth_mode, auth_credential,
            expire_time, enable_flag, status_cd, last_sync_time, create_by, create_time, update_time
        ) VALUES (
            source.auth_id, source.user_id, source.connector_id, source.auth_name, source.auth_mode,
            source.auth_credential, source.expire_time, source.enable_flag, source.status_cd,
            source.last_sync_time, source.create_by, source.create_time, source.update_time
        )
        """)
    int insertActiveIgnoreConflict(@Param("auth") ConnectorAuth auth);
}
