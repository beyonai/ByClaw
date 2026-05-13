package com.iwhalecloud.byai.state.application.service.searchask;

import com.alibaba.fastjson.JSON;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.qo.searchask.RecentlySearchAskQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.searchask.RecentlySearchAskVo;
import com.iwhalecloud.byai.state.domain.searchask.bean.SearchAsk;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.io.OutputStream;
import java.util.Date;

/**
 * @author he.duming
 * @date 2026-03-04 15:12:19
 * @description TODO
 */
@Service
public class SearchAskApplicationService {

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SessionService sessionService;

    /**
     * 搜问聊天记录
     *
     * @param searchAsk 会话
     * @param outputStream 响应流
     */
    public void chat(SearchAsk searchAsk, OutputStream outputStream) {

        if (searchAsk.getSessionId() == null) {
            ByaiSession session = this.createSession(searchAsk.getChatContent());
            // 创建会话输出
            String createSessionJson = JSON.toJSONString(session);
            CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.createSession, createSessionJson);

            // 设置session
            searchAsk.setSessionId(session.getSessionId());
        }

        CompletionsUtils.responseWrite(outputStream, SseResponseEventEnum.answerDelta, "Hello I am 搜问");

    }

    /**
     * 创建会话
     * 
     * @param chatContent 用户输入内容
     * @return ByaiSession
     */
    private ByaiSession createSession(String chatContent) {
        ByaiSession byaiSession = new ByaiSession();
        byaiSession.setSessionId(sequenceService.nextVal());
        byaiSession.setParentSessionId(-1L);
        byaiSession.setSessionName(StringUtils.substring(chatContent, 0, 10));
        byaiSession.setSessionContent(chatContent);
        byaiSession.setCreateTime(new Date());
        byaiSession.setCreatorId(CurrentUserHolder.getCurrentUserId());
        byaiSession.setSessionType(SessionType.H_S_A.getCode());
        byaiSession.setIsDebug(DebugModeEnum.DEBUG_0.getNum());
        byaiSession.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        sessionService.save(byaiSession);
        return byaiSession;
    }

    /**
     * 最近的搜问
     * 
     * @param recentlySearchAskQo 查询对象
     * @return PageInfo
     */
    public PageInfo<RecentlySearchAskVo> queryRecentlySearchAsk(RecentlySearchAskQo recentlySearchAskQo) {

        Integer pageNum = recentlySearchAskQo.getPageNum();
        Integer pageSize = recentlySearchAskQo.getPageSize();
        Page<RecentlySearchAskVo> page = PageHelper.startPage(pageNum, pageSize);
        // 只查当前用户的搜问信息
        recentlySearchAskQo.setCreatorId(CurrentUserHolder.getCurrentUserId());
        recentlySearchAskQo.setSessionType(SessionType.H_S_A.getCode());
        sessionService.queryRecentlySearchAsk(recentlySearchAskQo);

        return PageHelperUtil.toPageInfo(page);
    }
}
