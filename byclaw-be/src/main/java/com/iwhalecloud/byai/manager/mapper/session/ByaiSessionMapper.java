package com.iwhalecloud.byai.manager.mapper.session;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.dto.session.TemplateSessionQueryRequestDto;
import com.iwhalecloud.byai.manager.dto.session.TemplateSessionQueryResponseDto;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.qo.searchask.RecentlySearchAskQo;
import com.iwhalecloud.byai.manager.qo.session.ByaiSessionQo;
import com.iwhalecloud.byai.manager.vo.searchask.RecentlySearchAskVo;
import org.apache.ibatis.annotations.Param;

import java.util.Date;
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

    /**
     * 当会话仍带有指定扩展状态时更新会话名称。
     *
     * @param sessionId 会话标识
     * @param sessionName 新会话名称
     * @param extParamCode 扩展参数编码
     * @param updateBy 更新人
     * @param updateTime 更新时间
     * @return 更新记录数
     */
    int updateSessionNameWhenExtExists(@Param("sessionId") Long sessionId,
        @Param("sessionName") String sessionName, @Param("extParamCode") String extParamCode,
        @Param("updateBy") Long updateBy, @Param("updateTime") Date updateTime);
}
