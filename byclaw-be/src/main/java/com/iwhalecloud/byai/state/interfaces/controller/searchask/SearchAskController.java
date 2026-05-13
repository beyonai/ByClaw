package com.iwhalecloud.byai.state.interfaces.controller.searchask;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.manager.qo.searchask.RecentlySearchAskQo;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.searchask.RecentlySearchAskVo;
import com.iwhalecloud.byai.state.application.service.searchask.SearchAskApplicationService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.domain.searchask.bean.SearchAsk;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.io.IOException;
import java.io.OutputStream;

/**
 * @author he.duming
 * @date 2026-03-04 15:10:43
 * @description TODO
 */
@RestController
@RequestMapping("/searchAsk")
public class SearchAskController {

    private static final Logger logger = LoggerFactory.getLogger(SearchAskController.class);


    @Autowired
    private SearchAskApplicationService searchAskApplicationService;

    /**
     * 搜问聊天记录
     * 
     * @param searchAsk 会话
     * @param response 响应
     */
    @PostMapping(value = "/chat")
    public void chat(@RequestBody SearchAsk searchAsk, HttpServletResponse response) {
        try {
            CompletionsUtils.setResHeader(response, true);
            OutputStream outputStream = response.getOutputStream();
            searchAskApplicationService.chat(searchAsk, outputStream);
        }
        catch (IOException e) {
            logger.error(e.getMessage(), e);
            throw new BaseException(I18nUtil.get("assistant.chat.network.busy"), e);
        }
    }

    /**
     * 查询最近会话
     * 
     * @param recentlySearchAskQo 查询对象
     */
    @PostMapping(value = "/queryRecentlySearchAsk")
    public ResponseUtil<?> queryRecentlySearchAsk(@RequestBody RecentlySearchAskQo recentlySearchAskQo) {
        PageInfo<RecentlySearchAskVo> page = searchAskApplicationService.queryRecentlySearchAsk(recentlySearchAskQo);
        return ResponseUtil.successResponse(page);
    }
}
