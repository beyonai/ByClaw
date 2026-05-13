package com.iwhalecloud.byai.manager.mapper.session;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.dto.session.TemplateSessionQueryRequestDto;
import com.iwhalecloud.byai.manager.dto.session.TemplateSessionQueryResponseDto;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.qo.searchask.RecentlySearchAskQo;
import com.iwhalecloud.byai.manager.qo.session.ByaiSessionQo;
import com.iwhalecloud.byai.manager.vo.searchask.RecentlySearchAskVo;

import java.util.List;

/**
 * 会话主表 Mapper，对应表：byai_session
 *
 * @author system
 */
public interface ByaiSessionMapper extends BaseMapper<ByaiSession> {

    /**
     * 根据条件查询会话列表
     *
     * @param byaiSessionQo 查询条件
     * @return 会话列表
     */
    List<ByaiSessionDto> qryConversations(ByaiSessionQo byaiSessionQo);

    /**
     * 根据条件查询模板会话列表
     *
     * @param request 查询条件
     * @return 模板会话列表
     */
    List<TemplateSessionQueryResponseDto> queryTemplateSessions(TemplateSessionQueryRequestDto request);

    /**
     * 搜问的会话
     *
     * @param recentlySessionQo 查询对象
     * @return List
     */
    List<RecentlySearchAskVo> queryRecentlySearchAsk(RecentlySearchAskQo recentlySessionQo);
}
