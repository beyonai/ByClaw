package com.iwhalecloud.byai.manager.mapper.users;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;

/**
 * 用户个人参数配置 Mapper。
 * @author qin.guoquan
 * @date 2026-06-22 00:00:00
 */
public interface UserPrivateParamMapper extends BaseMapper<UserPrivateParam> {

    /** 并发创建托管快照时忽略唯一键冲突，调用方随后查询并更新胜出记录；兼容 openGauss。 */
    @Insert("""
        MERGE INTO po_user_private_param target
        USING (
            SELECT
                #{param.paramId} AS param_id,
                #{param.userId} AS user_id,
                #{param.paramKey} AS param_key,
                #{param.paramValueCipher} AS param_value_cipher,
                #{param.paramValueLast4} AS param_value_last4,
                #{param.description} AS description,
                #{param.status} AS status,
                #{param.paramSource} AS param_source,
                #{param.sourceRef} AS source_ref,
                #{param.createBy} AS create_by,
                #{param.createTime} AS create_time,
                #{param.updateBy} AS update_by,
                #{param.updateTime} AS update_time,
                #{param.deleteFlag} AS delete_flag
        ) source
        ON (
            target.user_id = source.user_id
            AND target.param_source = source.param_source
            AND target.source_ref = source.source_ref
            AND target.delete_flag = '0'
            AND target.param_source = 'CONNECTOR'
        )
        WHEN NOT MATCHED THEN INSERT (
            param_id, user_id, param_key, param_value_cipher, param_value_last4, description,
            status, param_source, source_ref, create_by, create_time, update_by, update_time, delete_flag
        ) VALUES (
            source.param_id, source.user_id, source.param_key, source.param_value_cipher,
            source.param_value_last4, source.description, source.status, source.param_source,
            source.source_ref, source.create_by, source.create_time, source.update_by,
            source.update_time, source.delete_flag
        )
        """)
    int insertConnectorSnapshotIgnoreConflict(@Param("param") UserPrivateParam param);
}
