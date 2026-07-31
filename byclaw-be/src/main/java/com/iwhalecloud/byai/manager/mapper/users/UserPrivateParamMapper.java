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

    /** 并发创建托管快照时忽略任一唯一键冲突，调用方随后查询并更新胜出记录。 */
    @Insert("""
        INSERT INTO po_user_private_param (
            param_id, user_id, param_key, param_value_cipher, param_value_last4, description,
            status, param_source, source_ref, create_by, create_time, update_by, update_time, delete_flag
        ) VALUES (
            #{param.paramId}, #{param.userId}, #{param.paramKey}, #{param.paramValueCipher},
            #{param.paramValueLast4}, #{param.description}, #{param.status}, #{param.paramSource},
            #{param.sourceRef}, #{param.createBy}, #{param.createTime}, #{param.updateBy},
            #{param.updateTime}, #{param.deleteFlag}
        )
        ON CONFLICT DO NOTHING
        """)
    int insertConnectorSnapshotIgnoreConflict(@Param("param") UserPrivateParam param);
}
