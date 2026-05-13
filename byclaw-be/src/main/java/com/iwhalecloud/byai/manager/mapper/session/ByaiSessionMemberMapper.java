package com.iwhalecloud.byai.manager.mapper.session;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.qo.session.SessionByAgentQo;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/**
 * 会话成员表 Mapper 对应表：byai_session_member
 *
 * @author system
 */
public interface ByaiSessionMemberMapper extends BaseMapper<ByaiSessionMember> {

    /**
     * 查询会话成员
     *
     * @param sessionId 会话标识
     * @param memObjType 成员对象类型
     * @param memObjId 成员对象ID
     * @return 会话成员信息
     */
    ByaiSessionMember findSessionMember(@Param("sessionId") Long sessionId, @Param("memObjType") String memObjType,
        @Param("memObjId") Long memObjId);

    /**
     * 根据ID更新会话成员（只更新非空字段）
     *
     * @param sessionMember 会话成员信息
     * @return 影响行数
     */
    int updateSelective(ByaiSessionMember sessionMember);

    /**
     * 根据成员对象ID和时间范围查询会话成员列表
     *
     * @param memObjId 成员对象ID
     * @param startTime 开始时间
     * @param endTime 结束时间
     * @return 会话成员列表
     */
    List<ByaiSessionMember> findByMemObjIdAndTimeRange(@Param("memObjId") Object memObjId,
        @Param("startTime") String startTime, @Param("endTime") String endTime);

    /**
     * 根据数字员工标识查询会话信息
     *
     * @param sessionByAgentQo 查询对象
     * @return List
     */
    List<Map<String, Object>> querySessionByAgent(SessionByAgentQo sessionByAgentQo);

}
