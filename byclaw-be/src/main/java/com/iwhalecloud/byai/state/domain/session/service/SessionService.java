package com.iwhalecloud.byai.state.domain.session.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.convert.Convert;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionExtMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.manager.qo.searchask.RecentlySearchAskQo;
import com.iwhalecloud.byai.manager.vo.searchask.RecentlySearchAskVo;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.qo.MessageHotDelQo;
import com.iwhalecloud.byai.common.message.qo.MessageHotQo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.state.domain.session.dto.SessionMembersDto;
import com.iwhalecloud.byai.state.domain.session.enums.TemplateType;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.qo.session.ByaiSessionQo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMessageEditRequestDto;
import com.iwhalecloud.byai.common.log.exception.BaseRuntimeException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateSessionDetailResponseDto;
import com.iwhalecloud.byai.manager.dto.session.TemplateSessionQueryRequestDto;
import com.iwhalecloud.byai.manager.dto.session.TemplateSessionQueryResponseDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateSaveRequestDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateUpdateRequestDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMessagesCopyRequestDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMembersCopyRequestDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMessagesCopyResponseDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMembersCopyResponseDto;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

/**
 * 记忆中心会话处理服务类
 */
@Service
public class SessionService {

    private final Logger logger = LoggerFactory.getLogger(SessionService.class);

    @Autowired
    private ByaiSessionMapper byaiSessionMapper;

    @Autowired
    private SessionExtService sessionExtService;

    @Autowired
    private SessionMemberService sessionMemberService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ByaiSessionExtMapper byaiSessionExtMapper;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    @Autowired
    private ByaiSessionMemberMapper byaiSessionMemberMapper;

    /**
     * 创建会话
     *
     * @param sessionId 会话信息
     * @return ResponseUtil
     */
    public ByaiSession findById(Long sessionId) {
        return byaiSessionMapper.selectById(sessionId);
    }

    /**
     * 批量查找
     *
     * @param sessionIds 会话标识
     * @return List<ByaiSession>
     */
    public List<ByaiSession> findBatchByIds(Collection<Long> sessionIds) {
        return byaiSessionMapper.selectBatchIds(sessionIds);
    }

    /**
     * 查询会话列表
     *
     * @param byaiSessionQo 查询参数
     * @return ResponseUtil
     */
    public PageInfo<ByaiSessionDto> qryConversations(ByaiSessionQo byaiSessionQo) {
        Integer pageNum = byaiSessionQo.getPageNum();
        Integer pageSize = byaiSessionQo.getPageSize();
        Page<ByaiSessionDto> page = PageHelper.startPage(pageNum, pageSize);
        byaiSessionMapper.qryConversations(byaiSessionQo);
        return PageHelperUtil.toPageInfo(page);
    }

    public ByaiSession findNotifySession(Long creatorId) {
        LambdaQueryWrapper<ByaiSession> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSession::getCreatorId, creatorId);
        queryWrapper.eq(ByaiSession::getObjectType, ConversationObjectType.NOTIFICATION);
        return byaiSessionMapper.selectOne(queryWrapper);
    }

    /**
     * 创建会话
     *
     * @param byaiSession 会话信息
     * @return ResponseUtil
     */
    public ByaiSession save(ByaiSession byaiSession) {
        byaiSessionMapper.insert(byaiSession);
        return byaiSession;
    }

    /**
     * 创建会话
     *
     * @param sessionId 删除会话
     */
    public void delete(Long sessionId) {
        byaiSessionMapper.deleteById(sessionId);
    }

    /**
     * 创建会话
     *
     * @param byaiSession 会话信息
     * @return ResponseUtil
     */
    public ByaiSession update(ByaiSession byaiSession) {
        byaiSessionMapper.updateById(byaiSession);
        return byaiSession;
    }

    /**
     * 创建群聊会话
     *
     * @param sessionMembersDto 创建群聊会话
     * @return MemoryResponse
     */
    public ByaiSession createSessionMembers(SessionMembersDto sessionMembersDto) {

        ByaiSession byaiSession = new ByaiSession();
        BeanUtil.copyProperties(sessionMembersDto, byaiSession);
        this.save(byaiSession);

        List<ByaiSessionMember> members = sessionMembersDto.getMembers();
        for (int i = 0; members != null && i < members.size(); i++) {
            ByaiSessionMember byaiSessionMember = members.get(i);
            sessionMemberService.save(byaiSessionMember);
        }

        List<ByaiSessionExt> sessionExts = sessionMembersDto.getSessionExts();
        for (int i = 0; sessionExts != null && i < sessionExts.size(); i++) {
            ByaiSessionExt byaiSessionExt = sessionExts.get(i);
            byaiSessionExt.setExtId(sequenceService.nextVal());
            byaiSessionExt.setSessionId(byaiSession.getSessionId());
            sessionExtService.save(byaiSessionExt);
        }

        return byaiSession;
    }

    /**
     * 分页查询会话模板列表
     *
     * @param request 查询请求
     * @return MemoryResponse 查询结果
     */
    public PageInfo<TemplateSessionQueryResponseDto> queryTemplateSessions(TemplateSessionQueryRequestDto request) {
        logger.debug("查询会话模板列表 - request: {}", JSON.toJSONString(request));

        Page<TemplateSessionQueryResponseDto> page = PageHelper.startPage(request.getPageNum(), request.getPageSize());
        byaiSessionMapper.queryTemplateSessions(request);

        PageInfo<TemplateSessionQueryResponseDto> pageInfo = PageHelperUtil.toPageInfo(page);

        List<TemplateSessionQueryResponseDto> list = pageInfo.getList();
        for (TemplateSessionQueryResponseDto templateSessionQueryResponseDto : list) {
            this.convertToTemplateSessionResponse(templateSessionQueryResponseDto);
        }

        return pageInfo;
    }

    /**
     * 转换为模板会话响应DTO
     *
     * @param templateSessionQueryResponseDto 模板参数
     */
    private void convertToTemplateSessionResponse(TemplateSessionQueryResponseDto templateSessionQueryResponseDto) {

        Long sessionId = templateSessionQueryResponseDto.getSessionId();
        List<ByaiSessionExt> extParams = sessionExtService.selectBySessionId(sessionId);

        // 提取模板参数
        for (ByaiSessionExt ext : extParams) {
            switch (ext.getExtParamCode()) {
                case "template_type":
                    templateSessionQueryResponseDto.setTemplateType(ext.getExtParamValue());
                    break;
                case "template_cover_id":
                    templateSessionQueryResponseDto.setTemplateCoverId(ext.getExtParamValue());
                    break;
                case "template_title":
                    templateSessionQueryResponseDto.setTemplateTitle(ext.getExtParamValue());
                    break;
                case "original_session_id":
                    String originalSessionId = ext.getExtParamValue();
                    templateSessionQueryResponseDto
                        .setOriginalSessionId(originalSessionId != null ? Long.valueOf(originalSessionId) : null);
                    break;
                default:
                    // 忽略其他扩展参数
                    break;
            }
        }

        // 获取模板类型显示名称
        String templateTypeName = null;
        if (templateSessionQueryResponseDto.getTemplateType() != null) {
            TemplateType type = TemplateType.fromCode(templateSessionQueryResponseDto.getTemplateType());
            if (type != null) {
                templateTypeName = type.getDisplayName();
            }
        }

        templateSessionQueryResponseDto.setIsTemplate(true);
        templateSessionQueryResponseDto.setTemplateTypeName(templateTypeName);
    }

    /**
     * 根据会话ID查询模板详情
     *
     * @param sessionId 会话ID
     * @return MemoryResponse 模板详情
     */
    public TemplateSessionDetailResponseDto getTemplateSessionDetail(Long sessionId) {

        logger.info("开始获取模板会话详情: sessionId={}", sessionId);

        /* 1. 查询会话是否存在 */
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        if (session == null) {
            logger.info("会话不存在: sessionId={}", sessionId);
            return null;
        }

        /* 2. 检查是否为模板会话 */
        boolean isTemplate = (session.getIsDebug() != null && session.getIsDebug() == 2);
        if (!isTemplate) {
            logger.info("该会话不是模板会话: sessionId={}, isDebug={}", sessionId, session.getIsDebug());
            return null;
        }

        /* 3. 查询模板扩展参数 */
        List<ByaiSessionExt> extParams = byaiSessionExtMapper.selectBySessionId(sessionId);

        /* 4. 构建会话基本信息 */
        TemplateSessionDetailResponseDto.SessionInfo sessionInfo = new TemplateSessionDetailResponseDto.SessionInfo();
        sessionInfo.setSessionId(session.getSessionId());
        sessionInfo.setSessionName(session.getSessionName());
        sessionInfo.setSessionContent(session.getSessionContent());
        sessionInfo.setSessionType(session.getSessionType());
        sessionInfo.setCreatorId(session.getCreatorId());
        sessionInfo.setEnterpriseId(session.getEnterpriseId());
        sessionInfo.setCreateTime(session.getCreateTime());
        sessionInfo.setUpdateTime(session.getUpdateTime());
        sessionInfo.setIsTemplate(true);

        // 5. 构建模板扩展信息
        TemplateSessionDetailResponseDto.TemplateExtInfo templateExtInfo = buildTemplateExtInfo(extParams);

        // 6. 查询聊天记录列表
        List<TemplateSessionDetailResponseDto.MessageInfo> messageList = getSessionMessages(sessionId);

        // 7. 构建返回结果
        TemplateSessionDetailResponseDto templateSessionDetailResponseDto = new TemplateSessionDetailResponseDto();
        templateSessionDetailResponseDto.setSessionInfo(sessionInfo);
        templateSessionDetailResponseDto.setTemplateExtInfo(templateExtInfo);
        templateSessionDetailResponseDto.setMessageList(messageList);

        logger.info("成功获取模板会话详情: sessionId={}, 消息数量={}", sessionId, messageList.size());
        return templateSessionDetailResponseDto;

    }

    /**
     * 构建模板扩展信息
     */
    private TemplateSessionDetailResponseDto.TemplateExtInfo buildTemplateExtInfo(List<ByaiSessionExt> extParams) {
        String templateType = null;
        String templateCoverId = null;
        String templateTitle = null;
        String templateConfig = null;
        String originalSessionId = null;
        String terminal = null;

        for (ByaiSessionExt ext : extParams) {
            switch (ext.getExtParamCode()) {
                case "template_type":
                    templateType = ext.getExtParamValue();
                    break;
                case "template_cover_id":
                    templateCoverId = ext.getExtParamValue();
                    break;
                case "template_title":
                    templateTitle = ext.getExtParamValue();
                    break;
                case "template_config":
                    templateConfig = ext.getExtParamValue();
                    break;
                case "original_session_id":
                    originalSessionId = ext.getExtParamValue();
                    break;
                case "terminal":
                    terminal = ext.getExtParamValue();
                    break;
                default:
                    // 其他扩展参数已添加到extParamsMap中，无需特殊处理
                    break;
            }
        }

        // 获取模板类型显示名称
        String templateTypeName = null;
        if (templateType != null) {
            TemplateType type = TemplateType.fromCode(templateType);
            if (type != null) {
                templateTypeName = type.getDisplayName();
            }
        }

        TemplateSessionDetailResponseDto.TemplateExtInfo templateExtInfo = new TemplateSessionDetailResponseDto.TemplateExtInfo();
        templateExtInfo.setTemplateType(templateType);
        templateExtInfo.setTemplateTypeName(templateTypeName);
        templateExtInfo.setTemplateTitle(templateTitle);
        templateExtInfo.setTemplateCoverId(templateCoverId != null ? Long.valueOf(templateCoverId) : null);
        templateExtInfo.setTemplateConfig(templateConfig);
        templateExtInfo.setOriginalSessionId(originalSessionId != null ? Long.valueOf(originalSessionId) : null);
        templateExtInfo.setTerminal(terminal);
        return templateExtInfo;
    }

    /**
     * 获取会话消息列表
     */
    private List<TemplateSessionDetailResponseDto.MessageInfo> getSessionMessages(Long sessionId) {
        // 构建搜索条件
        Map<String, Object> searchCriteria = new HashMap<>();
        searchCriteria.put("sessionId", sessionId);

        MessageHotQo messageHotQo = new MessageHotQo();
        messageHotQo.setSessionId(sessionId);
        List<ByaiMessageHotDto> hotMessagesRaw = byaiMessageHotService.findByQo(messageHotQo);

        List<TemplateSessionDetailResponseDto.MessageInfo> allMessages = new ArrayList<>();
        for (ByaiMessageHotDto byaiMessageHotDto : hotMessagesRaw) {
            TemplateSessionDetailResponseDto.MessageInfo messageInfo = new TemplateSessionDetailResponseDto.MessageInfo();
            BeanUtils.copyProperties(byaiMessageHotDto, messageInfo);
            allMessages.add(messageInfo);
        }

        return allMessages;
    }

    /**
     * 编辑会话模板消息
     *
     * @param sessionId 会话ID
     * @param request 编辑请求
     */
    public void editTemplateMessage(Long sessionId, TemplateMessageEditRequestDto request) {
        logger.info("开始编辑模板会话消息: sessionId={}, messageId={}", sessionId, request.getMessageId());

        // 查询并校验会话是否存在且为模板会话
        this.getAndValidateTemplateSessionForEdit(sessionId);

        // 获取现有消息内容

        ByaiMessageHotDto byaiMessageHotDto = byaiMessageHotService.findById(request.getMessageId());
        if (byaiMessageHotDto == null) {
            throw new BaseRuntimeException("消息不存在: " + request.getMessageId());
        }

        // 验证消息是否属于该会话
        Long messageSessionId = byaiMessageHotDto.getSessionId();
        if (messageSessionId == null || !messageSessionId.toString().equals(sessionId.toString())) {
            throw new BaseRuntimeException("消息不属于该会话");
        }

        // 更新需要修改的字段
        byaiMessageHotDto.setMessageContent(request.getMessageContent());
        if (request.getMessageStruct() != null) {
            byaiMessageHotDto.setMessageStruct(request.getMessageStruct());
        }
        byaiMessageHotDto.setUpdateTime(new Date());
        byaiMessageHotService.updateSelective(byaiMessageHotDto);

        logger.info("成功编辑模板会话消息: sessionId={}, messageId={}", sessionId, request.getMessageId());
    }

    /**
     * 保存会话为模板
     *
     * @param originalSessionId 会话ID
     * @param request 保存请求
     * @return Long 保存结果
     */
    public Long saveAsTemplate(Long originalSessionId, TemplateSaveRequestDto request) {

        /* 1. 查询并校验原会话是否存在且不是模板会话 */
        ByaiSession originalSession = this.getAndValidateOriginalSession(originalSessionId);

        /* 2. 确定模板标题 */
        String templateTitle = this.determineTemplateTitle(request.getTemplateTitle(),
            originalSession.getSessionName());

        /* 3. 复制会话数据，创建新的模板会话 */
        Long newTemplateSessionId = this.copySessionAsTemplate(originalSession, request.getNewSessionId());

        /* 4. 保存模板扩展参数 */
        this.saveTemplateExtParams(newTemplateSessionId, templateTitle, originalSessionId, request);

        return newTemplateSessionId;
    }

    /**
     * 保存模板扩展参数
     */
    private void saveTemplateExtParams(Long sessionId, String templateTitle, Long originalSessionId,
        TemplateSaveRequestDto request) {
        long currentTime = System.currentTimeMillis();

        // 保存模板标题
        ByaiSessionExt titleExt = new ByaiSessionExt();
        titleExt.setExtId(currentTime);
        titleExt.setSessionId(sessionId);
        titleExt.setExtParamName("模板标题");
        titleExt.setExtParamCode("template_title");
        titleExt.setExtParamValue(templateTitle);
        sessionExtService.save(titleExt);

        // 保存模板封面图片ID
        ByaiSessionExt imageExt = new ByaiSessionExt();
        imageExt.setExtId(currentTime + 1);
        imageExt.setSessionId(sessionId);
        imageExt.setExtParamName("模板封面图片");
        imageExt.setExtParamCode("template_cover_id");
        imageExt.setExtParamValue(request.getCoverId().toString());
        sessionExtService.save(imageExt);

        // 保存模板类型（保存编码而不是显示名称）
        String templateTypeCode = getTemplateTypeCode(request.getTemplateType());
        ByaiSessionExt typeExt = new ByaiSessionExt();
        typeExt.setExtId(currentTime + 2);
        typeExt.setSessionId(sessionId);
        typeExt.setExtParamName("模板类型");
        typeExt.setExtParamCode("template_type");
        typeExt.setExtParamValue(templateTypeCode);
        sessionExtService.save(typeExt);

        // 保存做同款配置
        String templateConfig = request.getTemplateConfig();
        if (templateConfig != null && !templateConfig.trim().isEmpty()) {
            ByaiSessionExt configExt = new ByaiSessionExt();
            configExt.setExtId(currentTime + 3);
            configExt.setSessionId(sessionId);
            configExt.setExtParamName("做同款配置");
            configExt.setExtParamCode("template_config");
            configExt.setExtParamValue(templateConfig);
            sessionExtService.save(configExt);
        }

        // 保存原始会话ID
        ByaiSessionExt originalExt = new ByaiSessionExt();
        originalExt.setExtId(currentTime + 4);
        originalExt.setSessionId(sessionId);
        originalExt.setExtParamName("原始会话ID");
        originalExt.setExtParamCode("original_session_id");
        originalExt.setExtParamValue(originalSessionId.toString());
        sessionExtService.save(originalExt);

        // 保存终端类型
        ByaiSessionExt terminalExt = new ByaiSessionExt();
        terminalExt.setExtId(currentTime + 5);
        terminalExt.setSessionId(sessionId);
        terminalExt.setExtParamName("终端类型");
        terminalExt.setExtParamCode("terminal");
        terminalExt.setExtParamValue(request.getTerminal());
        sessionExtService.save(terminalExt);

    }

    /**
     * 获取模板类型编码 传入的已经是编码，直接返回
     */
    private String getTemplateTypeCode(String templateType) {
        if (templateType == null || templateType.trim().isEmpty()) {
            return null;
        }

        // 验证编码是否有效
        if (!TemplateType.isValidCode(templateType)) {
            String validCodes = String.join("、", TemplateType.getAllCodes());
            throw new BaseRuntimeException("无效的模板类型编码: " + templateType + "，只支持：" + validCodes);
        }

        return templateType.trim();
    }

    /**
     * 查询并校验原会话是否存在且不是模板会话
     */
    private ByaiSession getAndValidateOriginalSession(Long sessionId) {
        ByaiSession session = this.getAndValidateExistingSession(sessionId);

        // 检查是否为模板会话
        boolean isTemplate = (session.getIsDebug() != null && session.getIsDebug() == 2);
        if (isTemplate) {
            throw new BaseRuntimeException("该会话已经是模板会话，不能重复保存为模板");
        }

        return session;
    }

    /**
     * 查询并校验会话是否存在
     */
    private ByaiSession getAndValidateExistingSession(Long sessionId) {
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        if (session == null) {
            throw new BaseRuntimeException("会话不存在: " + sessionId);
        }
        return session;
    }

    /**
     * 确定模板标题
     */
    private String determineTemplateTitle(String requestTitle, String sessionName) {
        if (requestTitle != null && !requestTitle.trim().isEmpty()) {
            return requestTitle.trim();
        }
        return sessionName;
    }

    /**
     * 复制会话数据，创建新的模板会话
     */
    private Long copySessionAsTemplate(ByaiSession originalSession, Long newSessionId) {
        // 创建新的会话记录
        ByaiSession newTemplateSession = new ByaiSession();
        newTemplateSession.setSessionId(newSessionId);
        newTemplateSession.setParentSessionId(originalSession.getSessionId());
        newTemplateSession.setSessionName(originalSession.getSessionName());
        newTemplateSession.setSessionContent(originalSession.getSessionContent());
        newTemplateSession.setSessionType(originalSession.getSessionType());
        newTemplateSession.setCreatorId(originalSession.getCreatorId());
        newTemplateSession.setObjectType(originalSession.getObjectType());
        newTemplateSession.setObjectId(originalSession.getObjectId());
        newTemplateSession.setEnterpriseId(originalSession.getEnterpriseId());
        newTemplateSession.setIsDebug(2);
        newTemplateSession.setUpdateBy(originalSession.getUpdateBy());
        newTemplateSession.setState(originalSession.getState());
        newTemplateSession.setCreateTime(new Date());
        newTemplateSession.setUpdateTime(new Date());

        // 插入新的模板会话记录
        int result = byaiSessionMapper.insert(newTemplateSession);
        if (result <= 0) {
            throw new BaseRuntimeException("创建模板会话失败");
        }

        logger.info("成功创建模板会话: 原sessionId={}, 新templateSessionId={}", originalSession.getSessionId(),
            newTemplateSession.getSessionId());

        return newTemplateSession.getSessionId();
    }

    /**
     * 更新会话模板
     *
     * @param templateSessionId 会话ID
     * @param request 更新请求
     * @return MemoryResponse 更新结果
     */
    public Long updateTemplate(Long templateSessionId, TemplateUpdateRequestDto request) {

        logger.debug("更新会话模板 - sessionId: {}, request: {}", templateSessionId, JSON.toJSONString(request));

        /* 1. 查询并校验模板会话是否存在 */
        this.getAndValidateTemplateSession(templateSessionId);

        /* 2. 更新模板扩展参数 */
        updateTemplateExtParams(templateSessionId, request);

        logger.info("成功更新模板会话参数: templateSessionId={}", templateSessionId);

        return templateSessionId;
    }

    /**
     * 更新模板扩展参数
     *
     * @param sessionId 会话标识
     * @param request 请求
     */
    private void updateTemplateExtParams(Long sessionId, TemplateUpdateRequestDto request) {
        logger.info("开始更新模板扩展参数: sessionId={}", sessionId);

        /* 更新模板扩展参数 */
        if (request.getTemplateTitle() != null && !request.getTemplateTitle().trim().isEmpty()) {
            saveOrUpdateExtParam(sessionId, "template_title", "模板标题", request.getTemplateTitle().trim());
        }

        if (request.getCoverId() != null) {
            saveOrUpdateExtParam(sessionId, "template_cover_id", "模板封面图片", request.getCoverId().toString());
        }

        if (request.getTemplateType() != null && !request.getTemplateType().trim().isEmpty()) {
            String templateTypeCode = getTemplateTypeCode(request.getTemplateType());
            saveOrUpdateExtParam(sessionId, "template_type", "模板类型", templateTypeCode);
        }

        if (request.getTemplateConfig() != null) {
            saveOrUpdateExtParam(sessionId, "template_config", "做同款配置", request.getTemplateConfig());
        }

        if (request.getTerminal() != null) {
            saveOrUpdateExtParam(sessionId, "terminal", "终端类型", request.getTerminal());
        }

        logger.info("成功更新模板扩展参数: sessionId={}", sessionId);
    }

    /**
     * 保存或更新扩展参数
     */
    private void saveOrUpdateExtParam(Long sessionId, String paramCode, String paramName, String paramValue) {
        // 查询是否已存在该参数
        LambdaQueryWrapper<ByaiSessionExt> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSessionExt::getSessionId, sessionId);
        queryWrapper.eq(ByaiSessionExt::getExtParamCode, paramCode);
        ByaiSessionExt existingExt = byaiSessionExtMapper.selectOne(queryWrapper);
        if (existingExt != null) {
            // 更新现有参数
            existingExt.setExtParamValue(paramValue);
            byaiSessionExtMapper.updateById(existingExt);
        }
        else {
            // 新增参数
            long currentTime = System.currentTimeMillis();
            ByaiSessionExt newExt = new ByaiSessionExt();
            newExt.setExtId(currentTime);
            newExt.setSessionId(sessionId);
            newExt.setExtParamName(paramName);
            newExt.setExtParamCode(paramCode);
            newExt.setExtParamValue(paramValue);
            byaiSessionExtMapper.insert(newExt);
        }
    }

    /**
     * 查询并校验模板会话是否存在（用于更新模板参数）
     */
    private ByaiSession getAndValidateTemplateSession(Long sessionId) {
        return getAndValidateTemplateSession(sessionId, "无法更新模板参数");
    }

    /**
     * 查询并校验模板会话是否存在（用于获取模板详情）
     */
    private ByaiSession getAndValidateTemplateSessionForDetail(Long sessionId) {
        return getAndValidateTemplateSession(sessionId, "无法获取模板详情");
    }

    /**
     * 查询并校验模板会话是否存在（用于删除模板）
     */
    private ByaiSession getAndValidateTemplateSessionForDelete(Long sessionId) {
        return getAndValidateTemplateSession(sessionId, "无需删除");
    }

    /**
     * 查询并校验模板会话是否存在（用于编辑消息）
     */
    private ByaiSession getAndValidateTemplateSessionForEdit(Long sessionId) {
        return getAndValidateTemplateSession(sessionId, "无法编辑消息内容");
    }

    /**
     * 查询并校验模板会话是否存在（通用方法）
     */
    private ByaiSession getAndValidateTemplateSession(Long sessionId, String errorSuffix) {
        ByaiSession session = getAndValidateExistingSession(sessionId);

        // 检查是否为模板会话
        boolean isTemplate = (session.getIsDebug() != null && session.getIsDebug() == 2);
        if (!isTemplate) {
            throw new BaseRuntimeException("该会话不是模板会话，" + errorSuffix);
        }

        return session;
    }

    /**
     * 复制模板会话消息
     *
     * @param templateSessionId 模板会话ID
     * @param request 复制请求
     * @return MemoryResponse 复制结果
     */
    public TemplateMessagesCopyResponseDto copyTemplateMessages(Long templateSessionId,
        TemplateMessagesCopyRequestDto request) {

        logger.info("开始复制模板会话消息: templateSessionId={}, originalSessionId={}", templateSessionId,
            request.getOriginalSessionId());

        LocalDateTime startTime = LocalDateTime.now();

        /* 1. 校验模板会话是否存在 */
        getAndValidateTemplateSessionForDetail(templateSessionId);

        /* 2. 校验原会话是否存在 */
        getAndValidateExistingSession(request.getOriginalSessionId());

        /* 4. 查询需要复制的消息 */
        List<Map<String, Object>> originalMessages;
        if (request.getMessageIds() != null && !request.getMessageIds().isEmpty()) {
            // 按消息ID列表查询指定消息
            originalMessages = this.getMessagesByIds(request.getMessageIds());
            logger.info("按消息ID列表查询消息: originalSessionId={}, messageIds={}, 查询到消息数={}", request.getOriginalSessionId(),
                request.getMessageIds(), originalMessages.size());
        }
        else {
            // 按会话ID查询所有消息
            originalMessages = this.getSessionMessagesFromES(request.getOriginalSessionId());
            logger.info("按会话ID查询所有消息: originalSessionId={}, 查询到消息数={}", request.getOriginalSessionId(),
                originalMessages.size());
        }

        if (originalMessages.isEmpty()) {
            logger.info("没有消息需要复制: originalSessionId={}, messageIds={}", request.getOriginalSessionId(),
                request.getMessageIds());
            return this.buildEmptyCopyResult(templateSessionId, request.getOriginalSessionId(), startTime);
        }

        /* 5. 批量复制消息并替换文件ID */
        List<TemplateMessagesCopyResponseDto.MessageCopyResult> results = new ArrayList<>();
        int successCount = 0;
        int failedCount = 0;

        try {
            // 构建新的消息列表
            Map<String, Map<String, Object>> newMessages = new HashMap<>();
            for (Map<String, Object> originalMessage : originalMessages) {
                try {
                    Map<String, Object> newMessage = buildNewMessage(originalMessage, templateSessionId,
                        request.getFileMappings());
                    Long newMessageId = Convert.toLong(newMessage.get("messageId"));
                    newMessages.put(newMessageId.toString(), newMessage);

                    // 构建成功结果
                    TemplateMessagesCopyResponseDto.MessageCopyResult result = TemplateMessagesCopyResponseDto.MessageCopyResult
                        .builder().originalMessageId(Convert.toLong(originalMessage.get("messageId")))
                        .newMessageId(newMessageId).status("SUCCESS").build();
                    results.add(result);
                    successCount++;
                }
                catch (Exception e) {
                    logger.error("构建消息数据失败: originalMessageId={}, error={}", originalMessage.get("messageId"),
                        e.getMessage(), e);
                    TemplateMessagesCopyResponseDto.MessageCopyResult result = TemplateMessagesCopyResponseDto.MessageCopyResult
                        .builder().originalMessageId(Convert.toLong(originalMessage.get("messageId"))).status("FAILED")
                        .errorMessage(e.getMessage()).build();
                    results.add(result);
                    failedCount++;
                }
            }

            // 批量索引成功的消息
            if (!newMessages.isEmpty()) {
                boolean bulkResult = bulkIndexMessages(newMessages);
                if (!bulkResult) {
                    logger.warn("批量索引消息部分失败，但继续处理");
                }
            }

        }
        catch (Exception e) {
            logger.error("批量复制消息失败: templateSessionId={}, error={}", templateSessionId, e.getMessage(), e);
            // 如果批量索引失败，将所有成功构建的消息标记为失败
            for (TemplateMessagesCopyResponseDto.MessageCopyResult result : results) {
                if ("SUCCESS".equals(result.getStatus())) {
                    result.setStatus("FAILED");
                    result.setErrorMessage("批量索引失败: " + e.getMessage());
                    successCount--;
                    failedCount++;
                }
            }
        }

        LocalDateTime endTime = LocalDateTime.now();

        /* 6. 构建返回结果 */
        TemplateMessagesCopyResponseDto response = TemplateMessagesCopyResponseDto.builder()
            .templateSessionId(templateSessionId).originalSessionId(request.getOriginalSessionId())
            .totalCount(originalMessages.size()).successCount(successCount).failedCount(failedCount)
            .startTime(startTime).endTime(endTime).results(results).build();

        logger.info("复制模板会话消息完成: templateSessionId={}, 总数={}, 成功={}, 失败={}", templateSessionId, originalMessages.size(),
            successCount, failedCount);

        return response;
    }

    /**
     * 批量索引消息到ES
     */
    private boolean bulkIndexMessages(Map<String, Map<String, Object>> newMessages) {
        logger.info("开始批量索引消息: 消息数量={}", newMessages.size());

        for (Map<String, Object> newMessage : newMessages.values()) {
            byaiMessageHotService.add(MapParamUtil.mapToObject(newMessage, ByaiMessageHotDto.class));
        }
        return true;
    }

    /**
     * 构建新的消息记录
     */
    private Map<String, Object> buildNewMessage(Map<String, Object> originalMessage, Long templateSessionId,
        Map<String, TemplateMessagesCopyRequestDto.FileInfo> fileMappings) {

        Long newMessageId = sequenceService.nextVal(); // 生成新的消息ID

        // 复制消息数据
        @SuppressWarnings("unchecked")
        Map<String, Object> newMessage = new HashMap<>((Map<String, Object>) originalMessage);

        // 更新消息字段
        newMessage.put("messageId", newMessageId);
        newMessage.put("sessionId", templateSessionId);
        // 替换文件信息
        replaceFileInfoInMessage(newMessage, fileMappings);

        return newMessage;
    }

    /**
     * 替换消息中的文件信息
     */
    private void replaceFileInfoInMessage(Map<String, Object> message,
        Map<String, TemplateMessagesCopyRequestDto.FileInfo> fileMappings) {
        // 如果文件映射为空，说明没有文件需要替换
        if (fileMappings == null || fileMappings.isEmpty()) {
            logger.debug("文件映射为空，跳过文件信息替换");
            return;
        }

        // 处理relatedResources节点 - 通常是JSON字符串
        Object relatedResourcesObj = message.get("relatedResources");
        if (relatedResourcesObj instanceof String) {
            String relatedResourcesJson = (String) relatedResourcesObj;
            if (relatedResourcesJson != null && !relatedResourcesJson.trim().isEmpty()) {
                try {
                    // 解析JSON字符串为Map
                    @SuppressWarnings("unchecked")
                    Map<String, Object> relatedResources = JSON.parseObject(relatedResourcesJson, Map.class);

                    // 替换文件信息
                    boolean hasChanges = replaceFileInfoInRelatedResources(relatedResources, fileMappings);

                    // 如果有变化，将修改后的对象重新序列化为JSON字符串
                    if (hasChanges) {
                        String updatedJson = JSON.toJSONString(relatedResources);
                        message.put("relatedResources", updatedJson);
                    }
                }
                catch (Exception e) {
                    logger.warn("解析relatedResources JSON失败: {}", e.getMessage());
                }
            }
        }
    }

    /**
     * 替换relatedResources中的文件信息
     */
    private boolean replaceFileInfoInRelatedResources(Map<String, Object> relatedResources,
        Map<String, TemplateMessagesCopyRequestDto.FileInfo> fileMappings) {
        boolean hasChanges = false;

        // 1. 替换顶层files数组中的文件信息
        if (replaceFilesInArray(relatedResources, "files", fileMappings)) {
            hasChanges = true;
        }

        // 2. 处理extParams.files中的文件信息
        Object extParamsObj = relatedResources.get("extParams");
        if (extParamsObj instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> extParams = (Map<String, Object>) extParamsObj;

            Object extParamsFilesObj = extParams.get("files");
            if (extParamsFilesObj instanceof List) {
                @SuppressWarnings("unchecked")
                List<Object> extParamsFiles = (List<Object>) extParamsFilesObj;

                for (Object extParamFileObj : extParamsFiles) {
                    if (extParamFileObj instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> extParamFile = (Map<String, Object>) extParamFileObj;

                        // 2.1 替换extParams.files[].fileIds数组中的文件ID
                        if (replaceFileIdsInArray(extParamFile, "fileIds", fileMappings)) {
                            hasChanges = true;
                        }

                        // 2.2 替换extParams.files[].files数组中的文件信息
                        if (replaceFilesInArray(extParamFile, "files", fileMappings)) {
                            hasChanges = true;
                        }
                    }
                }
            }
        }

        return hasChanges;
    }

    /**
     * 替换数组中文件ID的通用方法（用于fileIds数组）
     *
     * @return 是否有文件ID被替换
     */
    private boolean replaceFileIdsInArray(Map<String, Object> parentMap, String arrayKey,
        Map<String, TemplateMessagesCopyRequestDto.FileInfo> fileMappings) {
        boolean hasChanges = false;
        Object fileIdsObj = parentMap.get(arrayKey);
        if (fileIdsObj instanceof List) {
            @SuppressWarnings("unchecked")
            List<Object> fileIds = (List<Object>) fileIdsObj;

            for (int i = 0; i < fileIds.size(); i++) {
                Object fileIdObj = fileIds.get(i);
                if (fileIdObj instanceof String) {
                    String oldFileId = (String) fileIdObj;
                    TemplateMessagesCopyRequestDto.FileInfo newFileInfo = fileMappings.get(oldFileId);
                    if (newFileInfo != null) {
                        // 替换文件ID
                        fileIds.set(i, newFileInfo.getFileId());
                        hasChanges = true;
                    }
                }
            }
        }
        return hasChanges;
    }

    /**
     * 替换数组中文件信息的通用方法
     *
     * @return 是否有文件信息被替换
     */
    private boolean replaceFilesInArray(Map<String, Object> parentMap, String arrayKey,
        Map<String, TemplateMessagesCopyRequestDto.FileInfo> fileMappings) {
        boolean hasChanges = false;
        Object filesObj = parentMap.get(arrayKey);
        if (filesObj instanceof List) {
            @SuppressWarnings("unchecked")
            List<Object> files = (List<Object>) filesObj;

            for (Object fileObj : files) {
                if (fileObj instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> file = (Map<String, Object>) fileObj;

                    // 获取原文件ID
                    Object fileIdObj = file.get("fileId");
                    if (fileIdObj instanceof String) {
                        String oldFileId = (String) fileIdObj;
                        TemplateMessagesCopyRequestDto.FileInfo newFileInfo = fileMappings.get(oldFileId);
                        if (newFileInfo != null) {
                            // 替换所有文件信息
                            file.put("fileId", newFileInfo.getFileId());
                            file.put("fileName", newFileInfo.getFileName());
                            file.put("fileSize", newFileInfo.getFileSize());
                            file.put("fileType", "file");
                            file.put("fileUrl", newFileInfo.getFileUrl());
                            hasChanges = true;
                        }
                    }
                }
            }
        }
        return hasChanges;
    }

    /**
     * 构建空的复制结果
     */
    private TemplateMessagesCopyResponseDto buildEmptyCopyResult(Long templateSessionId, Long originalSessionId,
        LocalDateTime startTime) {
        return TemplateMessagesCopyResponseDto.builder().templateSessionId(templateSessionId)
            .originalSessionId(originalSessionId).totalCount(0).successCount(0).failedCount(0).startTime(startTime)
            .endTime(LocalDateTime.now()).results(Collections.emptyList()).build();
    }

    private List<Map<String, Object>> getSessionMessagesFromES(Long originalSessionId) {

        List<Map<String, Object>> allMessages = new ArrayList<>();
        if (originalSessionId == null) {
            return allMessages;
        }

        MessageHotQo messageHotQo = new MessageHotQo();
        messageHotQo.setSessionId(originalSessionId);
        List<ByaiMessageHotDto> byaiMessageHotDtos = byaiMessageHotService.findByQo(messageHotQo);
        for (ByaiMessageHotDto byaiMessageHotDto : byaiMessageHotDtos) {
            allMessages.add(MapParamUtil.objectToMap(byaiMessageHotDto));
        }
        return allMessages;
    }

    /**
     * 按消息ID列表从ES查询消息
     */
    private List<Map<String, Object>> getMessagesByIds(List<Long> messageIds) {
        List<Map<String, Object>> allMessages = new ArrayList<>();

        if (messageIds == null || messageIds.isEmpty()) {
            return allMessages;
        }

        MessageHotQo messageHotQo = new MessageHotQo();
        messageHotQo.setMessageIds(messageIds);
        List<ByaiMessageHotDto> byaiMessageHotDtos = byaiMessageHotService.findByQo(messageHotQo);
        for (ByaiMessageHotDto byaiMessageHotDto : byaiMessageHotDtos) {
            allMessages.add(MapParamUtil.objectToMap(byaiMessageHotDto));
        }
        return allMessages;
    }

    /**
     * 复制模板会话成员
     *
     * @param templateSessionId 模板会话ID
     * @param request 复制请求
     * @return MemoryResponse 复制结果
     */
    public TemplateMembersCopyResponseDto copyTemplateMembers(Long templateSessionId,
        TemplateMembersCopyRequestDto request) {

        logger.info("开始复制模板会话成员: templateSessionId={}, originalSessionId={}", templateSessionId,
            request.getOriginalSessionId());

        LocalDateTime startTime = LocalDateTime.now();

        /* 1. 校验模板会话是否存在 */
        getAndValidateTemplateSessionForDetail(templateSessionId);

        /* 2. 校验原会话是否存在 */
        getAndValidateExistingSession(request.getOriginalSessionId());

        /* 3. 查询原会话的所有成员 */
        LambdaQueryWrapper<ByaiSessionMember> sessionMemberWrapper = new LambdaQueryWrapper<>();
        sessionMemberWrapper.eq(ByaiSessionMember::getSessionId, request.getOriginalSessionId());
        List<ByaiSessionMember> originalMembers = byaiSessionMemberMapper.selectList(sessionMemberWrapper);
        if (originalMembers.isEmpty()) {
            logger.info("原会话没有成员需要复制: originalSessionId={}", request.getOriginalSessionId());
            return buildEmptyMemberCopyResult(templateSessionId, request.getOriginalSessionId(), startTime);
        }

        /* 4. 批量复制成员 */
        List<TemplateMembersCopyResponseDto.MemberCopyResult> results = new ArrayList<>();
        int successCount = 0;
        int failedCount = 0;

        try {
            // 构建新的成员列表
            List<ByaiSessionMember> newMembers = new ArrayList<>();
            for (ByaiSessionMember originalMember : originalMembers) {
                try {
                    ByaiSessionMember newMember = buildNewMember(originalMember, templateSessionId,
                        request.getSessionMemberIdMappings());
                    newMembers.add(newMember);

                    // 构建成功结果
                    TemplateMembersCopyResponseDto.MemberCopyResult result = TemplateMembersCopyResponseDto.MemberCopyResult
                        .builder().originalUserId(originalMember.getMemObjId().toString())
                        .newUserId(newMember.getMemObjId().toString()).role(originalMember.getUserRole())
                        .status("SUCCESS").build();
                    results.add(result);
                    successCount++;
                }
                catch (Exception e) {
                    logger.error("构建成员数据失败: originalMemberId={}, error={}", originalMember.getByaiSessionMemberId(),
                        e.getMessage(), e);
                    TemplateMembersCopyResponseDto.MemberCopyResult result = TemplateMembersCopyResponseDto.MemberCopyResult
                        .builder().originalUserId(originalMember.getMemObjId().toString())
                        .role(originalMember.getUserRole()).status("FAILED").errorMessage(e.getMessage()).build();
                    results.add(result);
                    failedCount++;
                }
            }

            // 批量插入成功的成员
            if (!newMembers.isEmpty()) {
                int batchResult = sessionMemberService.batchSave(newMembers);
                logger.info("批量插入成员完成: templateSessionId={}, 插入数量={}", templateSessionId, batchResult);
            }

        }
        catch (Exception e) {
            logger.error("批量复制成员失败: templateSessionId={}, error={}", templateSessionId, e.getMessage(), e);
            // 如果批量插入失败，将所有成功构建的成员标记为失败
            for (TemplateMembersCopyResponseDto.MemberCopyResult result : results) {
                if ("SUCCESS".equals(result.getStatus())) {
                    result.setStatus("FAILED");
                    result.setErrorMessage("批量插入失败: " + e.getMessage());
                    successCount--;
                    failedCount++;
                }
            }
        }

        LocalDateTime endTime = LocalDateTime.now();

        /* 5. 构建返回结果 */
        TemplateMembersCopyResponseDto response = TemplateMembersCopyResponseDto.builder()
            .templateSessionId(templateSessionId).originalSessionId(request.getOriginalSessionId())
            .totalCount(originalMembers.size()).successCount(successCount).failedCount(failedCount).startTime(startTime)
            .endTime(endTime).results(results).build();

        logger.info("复制模板会话成员完成: templateSessionId={}, 总数={}, 成功={}, 失败={}", templateSessionId, originalMembers.size(),
            successCount, failedCount);

        return response;

    }

    /**
     * 构建空的成员复制结果
     */
    private TemplateMembersCopyResponseDto buildEmptyMemberCopyResult(Long templateSessionId, Long originalSessionId,
        LocalDateTime startTime) {
        return TemplateMembersCopyResponseDto.builder().templateSessionId(templateSessionId)
            .originalSessionId(originalSessionId).totalCount(0).successCount(0).failedCount(0).startTime(startTime)
            .endTime(LocalDateTime.now()).results(Collections.emptyList()).build();
    }

    /**
     * 构建新的成员记录
     */
    private ByaiSessionMember buildNewMember(ByaiSessionMember originalMember, Long templateSessionId,
        Map<Long, Long> sessionMemberIdMappings) {

        // 确定新的用户ID
        Long newSessionMemberId = sessionMemberIdMappings.get(originalMember.getByaiSessionMemberId());

        // 创建新的成员记录
        ByaiSessionMember newMember = new ByaiSessionMember();
        newMember.setByaiSessionMemberId(newSessionMemberId);
        newMember.setSessionId(templateSessionId);
        newMember.setMemObjType(originalMember.getMemObjType());
        newMember.setMemObjId(originalMember.getMemObjId());
        newMember.setUserRole(originalMember.getUserRole());
        newMember.setCreatorId(originalMember.getCreatorId());
        newMember.setComAcctId(originalMember.getComAcctId());
        newMember.setMemName(originalMember.getMemName());
        newMember.setCreateTime(originalMember.getCreateTime());
        return newMember;
    }

    /**
     * 删除模板会话
     *
     * @param templateSessionId 模板会话ID
     * @return void
     */
    public void deleteTemplateSession(Long templateSessionId) {

        logger.info("开始删除模板会话: templateSessionId={}", templateSessionId);

        // 1. 校验模板会话是否存在
        this.getAndValidateTemplateSessionForDelete(templateSessionId);

        // 2. 删除模板会话的所有消息（从ES）
        MessageHotDelQo messageHotDelQo = new MessageHotDelQo();
        messageHotDelQo.setSessionId(templateSessionId);
        byaiMessageHotService.deleteByQo(messageHotDelQo);

        // 3. 删除模板会话的所有成员
        LambdaQueryWrapper<ByaiSessionMember> sessionMemberWrapper = new LambdaQueryWrapper<>();
        sessionMemberWrapper.eq(ByaiSessionMember::getSessionId, templateSessionId);
        byaiSessionMemberMapper.delete(sessionMemberWrapper);

        // 4. 删除模板扩展参数

        LambdaQueryWrapper<ByaiSessionExt> sessionExtWrapper = new LambdaQueryWrapper<>();
        sessionExtWrapper.eq(ByaiSessionExt::getSessionId, templateSessionId);
        byaiSessionExtMapper.delete(sessionExtWrapper);

        // 5. 删除模板会话记录
        int result = byaiSessionMapper.deleteById(templateSessionId);
        if (result <= 0) {
            throw new BaseRuntimeException("删除模板会话失败");
        }

        logger.info("成功删除模板会话: templateSessionId={}", templateSessionId);

    }

    /**
     * 搜问的会话
     *
     * @param recentlySessionQo 查询对象
     * @return List
     */
    public List<RecentlySearchAskVo> queryRecentlySearchAsk(RecentlySearchAskQo recentlySessionQo) {
        return byaiSessionMapper.queryRecentlySearchAsk(recentlySessionQo);
    }

    /**
     * 创建会话
     *
     * @param sessionName 会话名称
     * @param sessionType 会话类型
     * @param objectId 对象标识
     * @param objectType 对象类型
     * @param isDebug 是否调试
     * @return ByaiSession
     */
    public ByaiSession createSession(String sessionName, String sessionType, Long objectId, String objectType,
        Integer isDebug) {
        ByaiSession byaiSession = new ByaiSession();
        byaiSession.setSessionId(sequenceService.nextVal());
        byaiSession.setParentSessionId(-1L);
        byaiSession.setCreateTime(new Date());
        byaiSession.setSessionName(sessionName);
        byaiSession.setSessionType(sessionType);
        byaiSession.setObjectId(objectId);
        byaiSession.setObjectType(objectType);
        byaiSession.setIsDebug(isDebug);
        byaiSession.setCreatorId(CurrentUserHolder.getCurrentUserId());
        byaiSession.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        byaiSessionMapper.insert(byaiSession);
        return byaiSession;
    }

}
