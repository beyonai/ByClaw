package com.iwhalecloud.byai.state.application.service.manage;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.qo.MessageHotQo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.application.service.index.IndexApplicationServiceV2;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.qo.session.ByaiSessionQo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.state.domain.agent.dto.SearchDto;
import com.iwhalecloud.byai.state.domain.agent.model.SearchTypeCheckResult;
import com.iwhalecloud.byai.manager.qo.index.DiscoverQo;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketVo;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.common.feign.request.manager.FindQo;
import com.iwhalecloud.byai.state.domain.chat.dto.MessageSearchDto;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

/**
 * 助手管理应用服务：提供数字员工/企业员工/会话的综合搜索能力。
 *
 * @author he.duming
 * @date 2026-02-03 12:11:49
 */
@Service
public class AssistantManApplicationService {

    private Logger logger = LoggerFactory.getLogger(AssistantManApplicationService.class);

    /** 搜索类型：全部 */
    private static final String ALL = "all";

    /** 搜索类型：数字员工 */
    private static final String DIGIT = "digit";

    /** 搜索类型：企业员工 */
    private static final String USER = "user";

    /** 搜索类型：会话记录 */
    private static final String SESSION = "session";

    @Autowired
    private SessionService sessionService;

    @Autowired
    private IndexApplicationServiceV2 indexApplicationServiceV2;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    /**
     * 综合搜索：按 type（digit/user/session/all）搜索数字员工、企业员工或会话记录。
     *
     * @param findQo 搜索条件与分页
     * @return 聚合后的搜索结果
     */
    public SearchDto find(FindQo findQo) {

        // 组装综合搜索结果
        SearchDto searchDto = new SearchDto();

        // 数字员工查询
        if (ALL.equalsIgnoreCase(findQo.getType()) || DIGIT.equalsIgnoreCase(findQo.getType())) {
            DiscoverQo discoverQo = new DiscoverQo();
            discoverQo.setPageNum(findQo.getPageIndex());
            discoverQo.setPageSize(findQo.getPageSize());
            discoverQo.setKeyword(findQo.getKeyword());
            PageInfo<DigitEmployMarketVo> pageInfo = indexApplicationServiceV2.discover(discoverQo);
            searchDto.setDigitList(pageInfo.getList());
        }

        // 初始化会话记录搜索结果列表
        if (ALL.equalsIgnoreCase(findQo.getType()) || SESSION.equalsIgnoreCase(findQo.getType())) {
            List<MessageSearchDto> sessionList = this.searchMessage(findQo);
            searchDto.setSessionList(sessionList);
        }

        return searchDto;
    }

    /**
     * 按关键词搜索当前用户会话消息：先搜消息/会话/参与者，再按会话聚合并按会话ID倒序返回。
     *
     * @param findQo 关键词与分页
     * @return 会话及匹配消息列表
     */
    private List<MessageSearchDto> searchMessage(FindQo findQo) {
        SearchTypeCheckResult typeResult = this.checkAndFilterSearchTypes(findQo.getSearchType());
        List<Long> messageSessionIds = new ArrayList<>();
        Map<Long, List<ByaiMessageHotDto>> messageDtoGroupBySessionId = new HashMap<>();
        if (typeResult.getValidSearchTypes().contains("message")) {
            messageDtoGroupBySessionId = this.searchMessageContent(findQo, messageSessionIds);
        }
        List<ByaiSessionDto> keywordSessions = new ArrayList<>();
        if (typeResult.getValidSearchTypes().contains("participant")
            || typeResult.getValidSearchTypes().contains("title")) {
            keywordSessions = this.searchSessionsAndParticipants(findQo, typeResult.getValidSessionSearchTypes());
        }
        Set<Long> allSessionIds = new HashSet<>(messageSessionIds);
        allSessionIds.addAll(keywordSessions.stream().map(ByaiSessionDto::getSessionId).toList());
        if (allSessionIds.isEmpty()) {
            return Collections.emptyList();
        }

        List<ByaiSession> allSessionData = sessionService.findBatchByIds(allSessionIds);
        return this.buildSearchResult(allSessionData, messageDtoGroupBySessionId);
    }

    /**
     * 校验并过滤搜索类型，仅保留 message/participant/title；空或非法时默认全部类型。
     *
     * @param inputTypes 前端传入的搜索类型列表
     * @return 有效类型及会话维度的有效类型
     */
    private SearchTypeCheckResult checkAndFilterSearchTypes(List<String> inputTypes) {
        final String searchTypeMessage = "message";
        final String searchTypeParticipant = "participant";
        final String searchTypeTitle = "title";
        List<String> validSearchTypes = new ArrayList<>();
        List<String> validSessionSearchTypes = new ArrayList<>();
        if (inputTypes == null || inputTypes.isEmpty()) {
            validSearchTypes.add(searchTypeMessage);
            validSearchTypes.add(searchTypeParticipant);
            validSearchTypes.add(searchTypeTitle);
        }
        else {
            for (String type : inputTypes) {
                if (searchTypeMessage.equals(type) || searchTypeParticipant.equals(type)
                    || searchTypeTitle.equals(type)) {
                    validSearchTypes.add(type);
                    if (searchTypeParticipant.equals(type) || searchTypeTitle.equals(type)) {
                        validSessionSearchTypes.add(type);
                    }
                }
                else {
                    logger.info("Invalid search type ignored: {}", type);
                }
            }
        }
        if (validSearchTypes.isEmpty()) {
            validSearchTypes.add(searchTypeMessage);
            validSearchTypes.add(searchTypeParticipant);
            validSearchTypes.add(searchTypeTitle);
            logger.info("No valid search types found, executing all search types");
        }
        SearchTypeCheckResult result = new SearchTypeCheckResult();
        result.setValidSearchTypes(validSearchTypes);
        result.setValidSessionSearchTypes(validSessionSearchTypes);
        return result;
    }

    /**
     * 按消息内容关键词搜索，结果按 sessionId 分组并回填 sessionId 列表。
     *
     * @param findUserDto 关键词与分页
     * @param messageSessionIds 输出参数，命中消息所属的会话ID列表
     * @return sessionId -> 该会话下命中消息列表
     */
    public Map<Long, List<ByaiMessageHotDto>> searchMessageContent(FindQo findUserDto, List<Long> messageSessionIds) {

        MessageHotQo messageHotQo = new MessageHotQo();
        messageHotQo.setKeyword(findUserDto.getKeyword());
        messageHotQo.setTopK(findUserDto.getPageSize());
        messageHotQo.setCreatorId(CurrentUserHolder.getCurrentUserId());
        List<ByaiMessageHotDto> byaiMessageHotDtos = byaiMessageHotService.findByQo(messageHotQo);

        messageSessionIds.addAll(byaiMessageHotDtos.stream().map(ByaiMessageHotDto::getSessionId).toList());

        return byaiMessageHotDtos.stream().collect(Collectors.groupingBy(ByaiMessageHotDto::getSessionId));
    }

    /**
     * 按会话标题或参与者关键词搜索会话列表。
     *
     * @param findUserDto 关键词、分页、会话类型
     * @param validSessionSearchTypes 会话维度搜索类型（title/participant）
     * @return 命中的会话列表
     */
    private List<ByaiSessionDto> searchSessionsAndParticipants(FindQo findUserDto,
        List<String> validSessionSearchTypes) {
        List<String> sessionTypeList = null;
        if (findUserDto.getSessionType() != null) {
            sessionTypeList = Collections.singletonList(findUserDto.getSessionType());
        }

        ByaiSessionQo byaiSessionQo = new ByaiSessionQo();
        byaiSessionQo.setPageNum(findUserDto.getPageIndex());
        byaiSessionQo.setPageSize(findUserDto.getPageSize());
        byaiSessionQo.setCreatorId(CurrentUserHolder.getCurrentUserId());
        byaiSessionQo.setSessionType(sessionTypeList);
        byaiSessionQo.setSearchKeyword(findUserDto.getKeyword());
        byaiSessionQo.setIsDebug(0);
        PageInfo<ByaiSessionDto> pageInfo = sessionService.qryConversations(byaiSessionQo);
        return pageInfo.getList();
    }

    /**
     * 将会话列表与按会话分组的消息合并为 MessageSearchDto 列表，按 sessionId 倒序。
     *
     * @param allSessionData 会话列表
     * @param messageDtoGroupBySessionId 会话ID -> 消息列表
     * @return 组装后的搜索结果列表
     */
    private List<MessageSearchDto> buildSearchResult(List<ByaiSession> allSessionData,
        Map<Long, List<ByaiMessageHotDto>> messageDtoGroupBySessionId) {
        List<MessageSearchDto> sessionDtoList = new ArrayList<>();

        for (ByaiSession sessionDto : allSessionData) {
            MessageSearchDto messageSearchDto = new MessageSearchDto();
            messageSearchDto.setSessionName(sessionDto.getSessionName());
            messageSearchDto.setSessionId(sessionDto.getSessionId());
            messageSearchDto.setSessionType(sessionDto.getSessionType());
            messageSearchDto.setSessionContent(sessionDto.getSessionContent());
            List<ByaiMessageHotDto> messages = messageDtoGroupBySessionId.get(sessionDto.getSessionId());
            messageSearchDto.setMessageDtoList(messages != null ? messages : new ArrayList<>());
            sessionDtoList.add(messageSearchDto);
        }

        return sessionDtoList.stream().sorted(Comparator.comparing(MessageSearchDto::getSessionId).reversed())
            .collect(Collectors.toList());
    }
}
