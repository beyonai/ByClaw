package com.iwhalecloud.byai.manager.mapper.connector;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorEnableStateDto;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Collection;

/**
 * 用户连接器授权绑定 Mapper。
 */
@Mapper
public interface ConnectorAuthMapper extends BaseMapper<ConnectorAuth> {

    /** 查询指定用户已授权连接器及其开启状态。 */
    @Select("""
        SELECT info.connector_code,
               info.skill_code,
               CASE
                   WHEN auth.connector_id IS NULL THEN FALSE
                   WHEN auth.enable_flag = 'Y'
                       AND COALESCE(auth.credential_state, 'UNKNOWN')
                           IN ('READY', 'REFRESH_NEEDED', 'EXPIRING', 'UNKNOWN') THEN TRUE
                   ELSE FALSE
               END AS enabled
        FROM byai_connector_info info
        LEFT JOIN (
            SELECT connector_id, enable_flag, credential_state
            FROM (
                SELECT connector_id,
                       enable_flag,
                       credential_state,
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
                #{auth.resourceId} AS resource_id,
                #{auth.instanceKey} AS instance_key,
                #{auth.definitionRevision} AS definition_revision,
                #{auth.endpointFingerprint} AS endpoint_fingerprint,
                #{auth.authName} AS auth_name,
                #{auth.authMode} AS auth_mode,
                #{auth.authCredential} AS auth_credential,
                #{auth.expireTime} AS expire_time,
                #{auth.accessExpireTime} AS access_expire_time,
                #{auth.refreshExpireTime} AS refresh_expire_time,
                #{auth.credentialState} AS credential_state,
                #{auth.renewalMode} AS renewal_mode,
                #{auth.lastVerifiedAt} AS last_verified_at,
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
            AND target.instance_key = source.instance_key
            AND target.status_cd = '00A'
        )
        WHEN NOT MATCHED THEN INSERT (
            auth_id, user_id, connector_id, resource_id, instance_key, definition_revision, endpoint_fingerprint,
            auth_name, auth_mode, auth_credential,
            expire_time, access_expire_time, refresh_expire_time, credential_state, renewal_mode,
            last_verified_at, enable_flag, status_cd, last_sync_time, create_by, create_time, update_time
        ) VALUES (
            source.auth_id, source.user_id, source.connector_id, source.resource_id, source.instance_key,
            source.definition_revision, source.endpoint_fingerprint, source.auth_name, source.auth_mode,
            source.auth_credential, source.expire_time, source.access_expire_time, source.refresh_expire_time,
            source.credential_state, source.renewal_mode, source.last_verified_at,
            source.enable_flag, source.status_cd,
            source.last_sync_time, source.create_by, source.create_time, source.update_time
        )
        """)
    int insertActiveIgnoreConflict(@Param("auth") ConnectorAuth auth);

    @Update("""
        UPDATE byai_connector_auth
        SET credential_state = 'REAUTH_REQUIRED',
            enable_flag = 'N',
            update_time = CURRENT_TIMESTAMP
        WHERE resource_id = #{resourceId}
          AND status_cd = '00A'
        """)
    int markReauthRequiredForResource(@Param("resourceId") Long resourceId);

    @Update("""
        UPDATE byai_connector_auth
        SET status_cd = '00X',
            enable_flag = 'N',
            update_time = CURRENT_TIMESTAMP
        WHERE resource_id = #{resourceId}
          AND status_cd = '00A'
        """)
    int disableForResource(@Param("resourceId") Long resourceId);

    @Select("""
        SELECT *
        FROM byai_connector_auth
        WHERE user_id = #{userId}
          AND connector_id = #{connectorId}
          AND instance_key = #{instanceKey}
          AND status_cd = '00A'
        """)
    ConnectorAuth selectActiveByInstance(
        @Param("userId") String userId,
        @Param("connectorId") Long connectorId,
        @Param("instanceKey") String instanceKey);

    /** Batch-load active user MCP bindings for the instance list shown in Connector Drawer. */
    @Select({
        "<script>",
        "SELECT * FROM byai_connector_auth",
        "WHERE user_id = #{userId}",
        "AND status_cd = '00A'",
        "AND resource_id IN",
        "<foreach collection='resourceIds' item='resourceId' open='(' separator=',' close=')'>",
        "#{resourceId}",
        "</foreach>",
        "</script>"
    })
    List<ConnectorAuth> selectActiveByResourceIds(
        @Param("userId") String userId,
        @Param("resourceIds") Collection<Long> resourceIds);

    @Update("""
        UPDATE byai_connector_auth
        SET enable_flag = #{enableFlag},
            update_time = CURRENT_TIMESTAMP
        WHERE user_id = #{userId}
          AND resource_id = #{resourceId}
          AND instance_key = #{instanceKey}
          AND status_cd = '00A'
          AND (
              #{enableFlag} = 'N'
              OR (
                  credential_state = 'READY'
                  AND definition_revision = #{definitionRevision}
                  AND endpoint_fingerprint = #{endpointFingerprint}
              )
          )
        """)
    int updateInstanceEnable(
        @Param("userId") String userId,
        @Param("resourceId") Long resourceId,
        @Param("instanceKey") String instanceKey,
        @Param("enableFlag") String enableFlag,
        @Param("definitionRevision") Long definitionRevision,
        @Param("endpointFingerprint") String endpointFingerprint);
}
