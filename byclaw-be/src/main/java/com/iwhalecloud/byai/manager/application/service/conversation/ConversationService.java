package com.iwhalecloud.byai.manager.application.service.conversation;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.serializer.SerializerFeature;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.ByaiSystemConfigListService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.conversation.FeedbackMsgInfoDto;
import com.iwhalecloud.byai.manager.dto.conversation.FeedbackTypeDto;
import com.iwhalecloud.byai.manager.dto.conversation.MessageDto;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.conversation.FeedbackMsgInfo;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.conversation.FeedbackMsgInfoMapper;
import com.iwhalecloud.byai.manager.mapper.superassist.SuasSuperassistMapper;
import com.iwhalecloud.byai.manager.qo.auth.OwnAuthQo;
import com.iwhalecloud.byai.manager.qo.conversation.FilterQo;
import com.iwhalecloud.byai.manager.qo.conversation.HandleFeedbackMsgQo;
import com.iwhalecloud.byai.manager.qo.conversation.MessageIndexQo;
import com.iwhalecloud.byai.manager.qo.conversation.MessageQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.auth.GrantObjType;
import com.iwhalecloud.byai.common.constants.auth.GrantToObjType;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.chat.ChatObjType;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchReponseDto;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchRequestDto;
import com.iwhalecloud.byai.common.message.dto.PageResult;
import com.iwhalecloud.byai.common.message.service.ByaiMessageRelObjService;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import java.time.format.DateTimeFormatter;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.collections.MapUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class ConversationService {

    private static final Logger logger = LoggerFactory.getLogger(ConversationService.class);


    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private ByaiMessageRelObjService byaiMessageRelObjService;

    @Autowired
    private UserService userService;

    @Autowired
    private ByaiSystemConfigListService byaiSystemConfigListService;

    @Autowired
    private SuasSuperassistMapper suasSuperassistMapper;

    @Autowired
    private FeedbackMsgInfoMapper feedbackMsgInfoMapper;

    /**
     * 分页查询消息列表
     *
     * @param messageQo 查询对象
     */
    public Map<String, Object> getMessageList(MessageQo messageQo) {
        Map<String, Object> res = new HashMap<>();

        // 判断是数字员工还是超级助�?
        MessageIndexQo searchQo = new MessageIndexQo();
        // 判断权限，并且设置�?
        judgePrivForList(searchQo, messageQo);
        setSearchQuery(searchQo, messageQo);
        logger.info("feign memory search qo:{}", JSON.toJSONString(searchQo, SerializerFeature.WriteMapNullValue));
        MemRelSearchRequestDto searchRequestDto = new MemRelSearchRequestDto();
        BeanUtils.copyProperties(searchQo, searchRequestDto);
        PageResult<MemRelSearchReponseDto> result = byaiMessageRelObjService.searchMem(searchRequestDto);
        // 此时查的是有回答�?
        buildMessageRes(result, res);
        return res;
    }

    private void judgePrivForList(MessageIndexQo searchQo, MessageQo messageQo) {

        String objType = messageQo.getObjType();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        // 如果是超级助手，业务管理员查看自身的（有选择人员，也只查看自身），平台管�?运维查看所有的,若有选择人员，则过滤
        if (ChatObjType.SUASS.equals(objType)) {
            searchQo.setResObjTypes(new ArrayList<>(List.of(ChatObjType.SUASS)));
            List<Long> askObjIds = new ArrayList<>();
            if (CurrentUserHolder.isPlatformAdminOrOperator() && CollectionUtils.isNotEmpty(messageQo.getCreatorId())) {
                askObjIds.addAll(messageQo.getCreatorId());
            }
            else {
                askObjIds.add(currentUserId);
            }
            searchQo.setAskObjIds(askObjIds);
            searchQo.setAskObjTypes(new ArrayList<>(List.of(ChatObjType.HUMAN)));
            searchQo.setResObjIds(messageQo.getResObjIdList());

        }
        // 数字员工只需要控制回复对象，对话人不限制
        else {
            List<Long> filterList = new ArrayList<>();
            // 如果是业务管理员，查询当前管理的所有数字员工的聊天记录，否则查看所�?
            if (CurrentUserHolder.isBusinessAdmin()) {
                setEmployeeIdList(filterList);
            }
            // todo 这里先注释掉只为有数�?
            // searchQo.setResObjTypes(List.of(ChatObjType.AGENT));
            // 平台运维/平台管理设置为null 如果有选择回复对象，优先选择
            searchQo.setResObjIds(messageQo.getResObjIdList() == null ? filterList : messageQo.getResObjIdList());
            // 对话人只考虑前端传入的过�?
            searchQo.setAskObjIds(messageQo.getCreatorId());
        }

    }

    private void setSearchQuery(MessageIndexQo searchQo, MessageQo messageQo) {

        // 1.设置来源渠道列表
        searchQo.setProjectIds(messageQo.getProjectId());
        // 2.设置来源终端列表
        searchQo.setAskAccessTerminals(messageQo.getAccessTerminal());
        // 3.设置对话时间
        if (messageQo.getEndTime() != null && messageQo.getStartTime() != null) {
            searchQo.setAskTimeRange(List.of(messageQo.getStartTime(), messageQo.getEndTime()));
        }
        // // 4.设置对话�?
        // setAskAndResObj(searchQo, isAgent, filterList, messageQo);

        // 5.设置分页
        searchQo.setPageNum(messageQo.getPageIndex());
        searchQo.setPageSize(messageQo.getPageSize());
        // 6.设置反馈类型
        searchQo.setFeedbackType(messageQo.getFeedbackType());

        // 7.设置反馈评分
        searchQo.setFeedbackScoreRange(messageQo.getFeedbackScore());
        // 8.设置反馈标签
        searchQo.setFeedbackLabels(messageQo.getFeedbackLabel());
        // 9.用户提问内容
        searchQo.setAskContent(messageQo.getUserQuestion());
        // 10. 设置选中的relId列表
        searchQo.setRelIdList(messageQo.getRelIdList());
        // 11. 是否全选
        searchQo.setIsAllNotSelect(messageQo.getIsAllNotSelect());
        // 12. 关键字模糊搜索
        searchQo.setKeyword(messageQo.getKeyword());
    }

//    private void buildMessageRes(SearchResponse response, Map<String, Object> res) {
//        List<MessageDto> list = setResList(response.getList());
//        // 补充用户反馈的处理信息
//        List<String> askMsgIdList = list.stream().map(MessageDto::getAskMsgId).filter(Objects::nonNull).toList();
//        Map<String, FeedbackMsgInfoDto> feedbackMsgInfoMap = queryFeedbackMsgInfo(askMsgIdList);
//        if (!feedbackMsgInfoMap.isEmpty()) {
//            for (MessageDto messageDto : list) {
//                FeedbackMsgInfoDto feedbackMsgInfo = feedbackMsgInfoMap.get(messageDto.getAskMsgId());
//                if (feedbackMsgInfo == null) {
//                    continue;
//                }
//                messageDto.setIsAssign(feedbackMsgInfo.getIsAssign());
//                messageDto.setAssignUser(feedbackMsgInfo.getAssignerName());
//                messageDto.setIsHandle(feedbackMsgInfo.getIsHandle());
//                messageDto.setHandleUser(feedbackMsgInfo.getHandlerName());
//                messageDto.setHandleTime(feedbackMsgInfo.getHandleTime());
//            }
//        }
//        res.put("list", list);
//        Map<String, Object> pageInfo = new HashMap<>();
//        pageInfo.put("total", response.getTotal());
//        pageInfo.put("pageNum", response.getPageNum());
//        pageInfo.put("pageSize", response.getPageSize());
//        pageInfo.put("totalPages", response.getTotalPages());
//        res.put("pageInfo", pageInfo);
//    }


    private void buildMessageRes(PageResult<MemRelSearchReponseDto> result, Map<String, Object> res) {
        List<MessageDto> list = setResList(result.getList());
        // 补充用户反馈的处理信息
        List<String> askMsgIdList = list.stream().map(MessageDto::getAskMsgId).filter(Objects::nonNull).toList();
        Map<String, FeedbackMsgInfoDto> feedbackMsgInfoMap = queryFeedbackMsgInfo(askMsgIdList);
        if (!feedbackMsgInfoMap.isEmpty()) {
            for (MessageDto messageDto : list) {
                FeedbackMsgInfoDto feedbackMsgInfo = feedbackMsgInfoMap.get(messageDto.getAskMsgId());
                if (feedbackMsgInfo == null) {
                    continue;
                }
                messageDto.setIsAssign(feedbackMsgInfo.getIsAssign());
                messageDto.setAssignUser(feedbackMsgInfo.getAssignerName());
                messageDto.setIsHandle(feedbackMsgInfo.getIsHandle());
                messageDto.setHandleUser(feedbackMsgInfo.getHandlerName());
                messageDto.setHandleTime(feedbackMsgInfo.getHandleTime());
            }
        }
        res.put("list", list);
        Map<String, Object> pageInfo = new HashMap<>();
        pageInfo.put("total", result.getTotal());
        pageInfo.put("pageNum", result.getPageNum());
        pageInfo.put("pageSize", result.getPageSize());
        pageInfo.put("totalPages", result.getTotalPages());
        res.put("pageInfo", pageInfo);
    }

    private List<MessageDto> setResList(List<MemRelSearchReponseDto> list) {
        if (CollectionUtils.isEmpty(list)) {
            return new ArrayList<>();
        }
        List<Long> agentIdList = new ArrayList<>();
        // List<Long> assistantIdList = new ArrayList<>();
        List<Long> userIdList = new ArrayList<>();
        list.forEach(message -> {
            if (ChatObjType.AGENT.equalsIgnoreCase(message.getResObjType())) {
                agentIdList.add(message.getResObjId());
            }
            else {
                userIdList.add(message.getResObjId());
            }
            userIdList.add(message.getAskObjId());
        });
        Map<Long, String> userMap = new HashMap<>();
        if (CollectionUtils.isNotEmpty(userIdList)) {
            List<Users> users = userService.findUsersByUserIds(userIdList);
            if (!CollectionUtils.isEmpty(users)) {
                userMap = users.stream().filter(item -> null != item.getUserId() && null != item.getUserName())
                    .collect(Collectors.toMap(Users::getUserId, Users::getUserName, (t1, t2) -> t1));
            }
        }
        // 数字员工是objid,用其他查�?
        Map<String, String> agentNameMap = new HashMap<>();
        List<MessageDto> resList = new ArrayList<>();
        DateTimeFormatter dateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        for (MemRelSearchReponseDto message : list) {
            MessageDto messageDto = new MessageDto();
            messageDto.setRelId(message.getRelId());
            messageDto.setSessionId(String.valueOf(message.getSessionId()));
            messageDto.setFeedbackLabels(message.getFeedbackLabel());
            messageDto.setFeedbackType(message.getFeedbackType());
            messageDto.setFeedbackScore(message.getFeedbackScore());
            messageDto.setSystemAnswer(message.getResContent());
            messageDto.setFeedbackContent(message.getFeedbackContent());
            messageDto.setUserQuestion(message.getAskContent());
            messageDto.setAccessTerminal(message.getAskAccessTerminal());
            messageDto.setAskMsgId(String.valueOf(message.getAskMsgId()));
            messageDto.setResMsgId(String.valueOf(message.getResMsgId()));
            messageDto.setProjectName("百应AI");
            // LocalDateTime 格式化为 yyyy-MM-dd HH:mm:ss
            messageDto.setCreateTime(message.getCreateTime() != null ?
                    message.getCreateTime().format(dateTimeFormatter) : null);
            messageDto.setTaskDueTime(message.getTaskDueTime());
            messageDto.setFirstTextDuration(message.getFirstTextDuration());
            messageDto.setRequestStatus(message.getRequestStatus());
            // 首先判断是哪种类型AGENT/ASSIST
            messageDto.setResponseObj(setResObj(message, agentNameMap, userMap));
            messageDto.setUserName(MapUtils.getString(userMap, message.getAskObjId(), ""));
            messageDto.setIsHandle(message.getIsHandle());
            resList.add(messageDto);
        }
        return resList;
    }

    private String setResObj(MemRelSearchReponseDto message, Map<String, String> agentNameMap, Map<Long, String> userMap) {
        if (message.getResObjId() == null) {
            return "";
        }
        if (ChatObjType.AGENT.equalsIgnoreCase(message.getResObjType())) {
            return MapUtils.getString(agentNameMap, String.valueOf(message.getResObjId()), "");
        }
        else {
            return MapUtils.getString(userMap, message.getResObjId(), "");
        }
    }

    private void setEmployeeIdList(List<Long> filterList) {
        // 查询管理的数字员�?
        List<PrivilegeGrant> privilegeGrantList = authApplicationService.listAuthPrivilegeGrant(GrantType.ALLOW_MANAGE,
            List.of(GrantObjType.AGENT), GrantToObjType.USER, CurrentUserHolder.getCurrentUserId(), null);
        // 这里包含了下架的数字员工的聊天记�?
        List<Long> employeeIdList = privilegeGrantList.stream().map(PrivilegeGrant::getGrantObjId)
            .collect(Collectors.toList());
        // 如果没有，传-9999以便不查出其他的�?
        filterList.addAll(null == employeeIdList ? List.of(-9999L) : employeeIdList);
    }

    public ResponseUtil<List<ByaiSystemConfigList>> getAccessTerminalList() {
        return ResponseUtil.successResponse(I18nUtil.get("conversation.access.terminal.list.query.success"),
            byaiSystemConfigListService.findByParamGroupCode(Constants.ACCESSTERMINAL));
    }

    public ResponseUtil<List<ByaiSystemConfigList>> getProjectIdList() {
        return ResponseUtil.successResponse(I18nUtil.get("conversation.project.id.list.query.success"),
            byaiSystemConfigListService.findByParamGroupCode(Constants.AGENT_SPACE_ID));
    }

    public Map<String, List<FeedbackTypeDto>> getContentFeedbackType() {
        List<ByaiSystemConfigList> values = byaiSystemConfigListService.findByParamGroupCode(Constants.FEEDBACK_TYPE);
        if (CollectionUtils.isEmpty(values)) {
            return new HashMap<>();
        }
        Map<String, List<FeedbackTypeDto>> res = new HashMap<>();
        Map<String, List<ByaiSystemConfigList>> groupedConfigs = values.stream()
            .filter(config -> config.getParamGroupCode() != null)
            .collect(Collectors.groupingBy(ByaiSystemConfigList::getParamGroupCode));

        groupedConfigs.forEach((paramGroupCode, configs) -> {
            configs.sort(Comparator.comparing(ByaiSystemConfigList::getParamSeq,
                Comparator.nullsLast(Comparator.naturalOrder())));
            configs.forEach(config -> {
                FeedbackTypeDto feedbackTypeDto = new FeedbackTypeDto();
                BeanUtils.copyProperties(config, feedbackTypeDto);
                res.computeIfAbsent(paramGroupCode, list -> new ArrayList<>()).add(feedbackTypeDto);
            });
        });
        return res;
    }

    public Object getSuassList(FilterQo qo) {
        Page<SuasSuperassist> page = new Page<>(qo.getPageIndex(), qo.getPageSize());
        LambdaQueryWrapper<SuasSuperassist> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.like(SuasSuperassist::getName, '%' + qo.getKeyWord() + '%');
        List<SuasSuperassist> suasSuperassists = suasSuperassistMapper.selectList(page, queryWrapper);
        page.setRecords(suasSuperassists);
        return PageHelperUtil.toPageInfo(page);
    }



    /**
     * 处理消息
     *
     * @param feedbackMsgQo 处理消息对象
     */
    public void handleFeedbackMsg(HandleFeedbackMsgQo feedbackMsgQo) {
        String askMsgId = feedbackMsgQo.getAskMsgId();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        LambdaQueryWrapper<FeedbackMsgInfo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(FeedbackMsgInfo::getFeedbackMsgId, askMsgId);

        // 后续可能是多条
        List<FeedbackMsgInfo> feedbackMsgInfos = feedbackMsgInfoMapper.selectList(wrapper);
        if (CollectionUtils.isNotEmpty(feedbackMsgInfos)) {
            // 指派后处理
            FeedbackMsgInfo feedbackMsgInfo = feedbackMsgInfos.get(0);
            feedbackMsgInfo.setHandleUser(currentUserId);
            feedbackMsgInfo.setIsHandle(1);
            feedbackMsgInfo.setHandleTime(new Date());
            feedbackMsgInfoMapper.updateById(feedbackMsgInfo);
            return;
        }
        // 直接处理
        FeedbackMsgInfo feedbackMsgInfo = new FeedbackMsgInfo();
        feedbackMsgInfo.setHandleUser(currentUserId);
        feedbackMsgInfo.setIsHandle(1);
        feedbackMsgInfo.setHandleTime(new Date());
        feedbackMsgInfo.setCreateUser(currentUserId);
        feedbackMsgInfo.setCreateTime(new Date());
        try {
            feedbackMsgInfo.setFeedbackMsgId(Long.parseLong(askMsgId));
        }
        catch (NumberFormatException e) {
            logger.error("Invalid askMsgId format:" + askMsgId, e);
            throw new BaseException(I18nUtil.get("invalid.askMsgId.format"), e);
        }
        feedbackMsgInfoMapper.insert(feedbackMsgInfo);
    }

    private Map<String, FeedbackMsgInfoDto> queryFeedbackMsgInfo(List<String> askMsgIdList) {
        Map<String, FeedbackMsgInfoDto> res = new HashMap<>();
        if (CollectionUtils.isEmpty(askMsgIdList)) {
            return res;
        }
        LambdaQueryWrapper<FeedbackMsgInfo> wrapper = new LambdaQueryWrapper<>();
        wrapper.in(FeedbackMsgInfo::getFeedbackMsgId, askMsgIdList);
        List<FeedbackMsgInfo> feedbackMsgInfos = feedbackMsgInfoMapper.selectList(wrapper);
        if (CollectionUtils.isEmpty(feedbackMsgInfos)) {
            return res;
        }
        Set<Long> userIdSet = new HashSet<>();
        feedbackMsgInfos.forEach(item -> {
            if (item.getAssignUser() != null) {
                userIdSet.add(item.getAssignUser());
            }
            if (item.getHandleUser() != null) {
                userIdSet.add(item.getHandleUser());
            }
        });
        // 存储用户信息
        Map<Long, String> userIdNameMap = new HashMap<>();
        if (CollectionUtils.isNotEmpty(userIdSet)) {
            List<Users> usersByUserIds = userService.findUsersByUserIds(userIdSet);
            if (CollectionUtils.isNotEmpty(usersByUserIds)) {
                userIdNameMap = usersByUserIds.stream().collect(Collectors.toMap(Users::getUserId, Users::getUserName));
            }
        }
        // 构建响应对象
        for (FeedbackMsgInfo feedbackMsgInfo : feedbackMsgInfos) {
            FeedbackMsgInfoDto feedbackMsgInfoDto = new FeedbackMsgInfoDto();
            BeanUtils.copyProperties(feedbackMsgInfo, feedbackMsgInfoDto);
            feedbackMsgInfoDto.setAssignerName(userIdNameMap.getOrDefault(feedbackMsgInfoDto.getAssignUser(), null));
            feedbackMsgInfoDto.setHandlerName(userIdNameMap.getOrDefault(feedbackMsgInfoDto.getHandleUser(), null));
            res.put(String.valueOf(feedbackMsgInfoDto.getFeedbackMsgId()), feedbackMsgInfoDto);
        }
        return res;
    }

    private OwnAuthQo setOwnAuthQo(FilterQo qo) {
        OwnAuthQo ownAuthQo = new OwnAuthQo();
        ownAuthQo.setPageNum(qo.getPageIndex().longValue());
        ownAuthQo.setPageSize(qo.getPageSize().longValue());
        ownAuthQo.setResourceName(qo.getKeyWord());
        ownAuthQo.setStatusList(List.of(2));
        return ownAuthQo;
    }
}
