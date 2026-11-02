package com.iwhalecloud.byai.manager.mapper.operations;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;
import java.util.Map;

/** 企业移除的群快照及可接任身份查询；写入复用 BaseMapper。 @author Codex @since 2026-10-27 */
@Mapper
public interface MemberGroupRemovalMapper extends BaseMapper<ByaiSessionMember> {
    /** @return 当前企业内该用户参加的存量工作组及真人成员 */
    List<Map<String, Object>> snapshot(@Param("enterpriseId") long enterpriseId, @Param("userId") long userId);
    /** @return 当前企业启用且账号正常的接任候选人 */
    List<Map<String, Object>> candidates(@Param("enterpriseId") long enterpriseId);
    /** @return 仍有企业所有者或内置超管权限的操作人 */
    Map<String, Object> actor(@Param("enterpriseId") long enterpriseId, @Param("actorId") long actorId);
}
