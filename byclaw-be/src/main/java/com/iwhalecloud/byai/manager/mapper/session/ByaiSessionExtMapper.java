package com.iwhalecloud.byai.manager.mapper.session;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 会话扩展参数表 Mapper 对应表：byai_session_ext
 *
 * @author system
 */

public interface ByaiSessionExtMapper extends BaseMapper<ByaiSessionExt> {

    /**
     * 根据会话ID查询扩展参数列表
     *
     * @param sessionId 会话标识
     * @return 扩展参数列表
     */
    List<ByaiSessionExt> selectBySessionId(@Param("sessionId") Long sessionId);
}
