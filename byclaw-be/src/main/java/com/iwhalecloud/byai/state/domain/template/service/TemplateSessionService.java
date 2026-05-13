package com.iwhalecloud.byai.state.domain.template.service;

import cn.hutool.core.map.MapUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.men.MenResCom;
import com.iwhalecloud.byai.manager.entity.men.MenTaskCatalog;
import com.iwhalecloud.byai.manager.entity.men.MenTask;
import com.iwhalecloud.byai.manager.entity.men.MenTaskRecObj;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.qo.men.MenTaskQueryQo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.qo.MessageHotQo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.manager.vo.men.MenTaskVo;
import com.iwhalecloud.byai.manager.mapper.men.MenResComMapper;
import com.iwhalecloud.byai.manager.mapper.men.MenTaskCatalogMapper;
import com.iwhalecloud.byai.manager.mapper.men.MenTaskMapper;
import com.iwhalecloud.byai.manager.mapper.men.MenTaskRecObjMapper;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.state.domain.men.service.MenTaskService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.template.enums.TemplateTypeEnum;
import com.iwhalecloud.byai.state.interfaces.controller.manage.dto.TemplateSessionSaveRequestDto;
import cn.hutool.core.util.StrUtil;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.FileNameMap;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMessageEditRequestDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateSaveRequestDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateUpdateRequestDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateSessionDetailResponseDto;
import com.iwhalecloud.byai.manager.dto.session.TemplateSessionQueryRequestDto;
import com.iwhalecloud.byai.manager.dto.session.TemplateSessionQueryResponseDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMessagesCopyRequestDto;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMembersCopyRequestDto;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.apache.commons.lang3.StringUtils;
import java.util.HashMap;
import java.util.Date;
import java.util.stream.Collectors;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.common.constants.Constants;
import org.springframework.web.multipart.MultipartFile;
import feign.Response;
import java.util.Collection;

/**
 * 模板会话服务层
 * <p>
 * 负责模板会话相关的业务逻辑处理，包括权限验证、参数校验、业务规则等。
 * </p>
 *
 * @author smartcloud
 * @version 1.0
 * @since 1.0
 */
@Slf4j
@Service
public class TemplateSessionService {

    @Autowired
    private SessionService sessionService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private TemplateFileProcessingService templateFileProcessingService;

    @Autowired
    private MenTaskService menTaskService;

    @Autowired
    private MenTaskMapper menTaskMapper;

    @Autowired
    private MenResComMapper menResComMapper;

    @Autowired
    private MenTaskRecObjMapper menTaskRecObjMapper;

    @Autowired
    private MenTaskCatalogMapper menTaskCatalogMapper;

    @Autowired
    private FileService fileService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private SessionMemberService sessionMemberService;

    /**
     * 保存或更新会话模板
     * <p>
     * 将指定会话保存为模板，支持设置模板标题、图片和类型。 包括模板会话基本信息新增、模板会话消息新增、模板会话成员新增。 文件需要下载重新上传获取新文件ID，构建文件ID映射关系。 只有平台管理员才能执行此操作。
     * </p>
     *
     * @param sessionId 会话ID
     * @param request 模板保存请求
     * @return 保存结果
     * @throws BdpRuntimeException 当操作失败时抛出
     */
    @Transactional(rollbackFor = Exception.class)
    public Long saveOrUpdateTemplate(Long sessionId, TemplateSessionSaveRequestDto request) {
        log.info("开始保存会话模板 - sessionId: {}, userId: {}, request: {}", sessionId, CurrentUserHolder.getCurrentUserId(),
            request);

        List<Long> rollbackActions = new ArrayList<>();
        Long templateSessionId;

        try {
            // 1. 参数校验
            validateSaveTemplateParameters(sessionId, request);

            // 2. 权限验证
            validatePlatformAdminPermission();

            // 3. 业务规则验证
            validateBusinessRules(sessionId, request);

            // 4. 判断是新增还是修改
            boolean isUpdate = isTemplateExists(sessionId);
            log.info("判断模板操作类型 - sessionId: {}, isUpdate: {}", sessionId, isUpdate);

            // 5. 如果是修改场景，直接调用updateTemplate接口
            if (isUpdate) {
                return updateTemplate(sessionId, request);
            }

            // 6. 新增场景：获取原会话的详细信息
            log.info("获取原会话详细信息 - sessionId: {}", sessionId);
            List<ByaiMessageHotDto> messages = getSessionMessages(sessionId, request.getMessageIds());

            // 7. 处理文件映射关系
            log.info("开始处理文件映射关系 - sessionId: {}", sessionId);
            Map<String, TemplateMessagesCopyRequestDto.FileInfo> fileMappings = templateFileProcessingService
                .processFilesInMessages(messages, sessionId.toString());
            log.info("文件映射关系处理完成 - sessionId: {}, 映射数量: {}", sessionId, fileMappings.size());

            // 8. 保存模板会话基本信息
            log.info("开始保存模板会话基本信息 - sessionId: {}", sessionId);
            templateSessionId = saveTemplateSessionBasicInfo(sessionId, request);
            rollbackActions.add(templateSessionId); // 简化回滚操作，只需要记录模板会话ID
            log.info("模板会话基本信息保存成功 - templateSessionId: {}", templateSessionId);

            // 9. 复制模板会话消息（包含文件映射）
            log.info("开始复制模板会话消息 - templateSessionId: {}, fileMappings: {}", templateSessionId, fileMappings);
            copyTemplateMessages(Long.valueOf(templateSessionId), sessionId, fileMappings, request.getMessageIds());
            log.info("模板会话消息复制成功 - templateSessionId: {}", templateSessionId);

            // 10. 复制模板会话成员
            log.info("开始复制模板会话成员 - templateSessionId: {}", templateSessionId);
            copyTemplateMembers(Long.valueOf(templateSessionId), sessionId);
            log.info("模板会话成员复制成功 - templateSessionId: {}", templateSessionId);

            // 11. 复制成果空间数据
            log.info("开始复制成果空间数据 - templateSessionId: {}", templateSessionId);
            copyResultSpaceData(Long.valueOf(templateSessionId), sessionId);
            log.info("成果空间数据复制成功 - templateSessionId: {}", templateSessionId);

            log.info("会话模板保存完成 - sessionId: {}, templateSessionId: {}", sessionId, templateSessionId);
            return templateSessionId;

        }

        catch (Exception e) {
            log.error("会话模板保存异常 - sessionId: {}, error: {}", sessionId, e.getMessage(), e);
            // 执行回滚操作

            throw new BdpRuntimeException(I18nUtil.get("template.session.save.error", e.getMessage()));
        }
    }

    /**
     * 分页查询会话模板列表
     * <p>
     * 支持按模板类型、关键字等条件查询模板列表。 该接口支持匿名访问，无需登录即可使用。
     * </p>
     *
     * @param request 查询请求
     * @return 查询结果
     * @throws BdpRuntimeException 当操作失败时抛出
     */
    public PageInfo<TemplateSessionQueryResponseDto> queryTemplateSessions(TemplateSessionQueryRequestDto request) {

        log.info("开始查询会话模板列表 - request: {}", request);

        // 1. 参数校验
        this.validateQueryTemplateParameters(request);

        // 2. 设置查询条件（匿名访问，无需权限验证）
        this.setupQueryConditions(request);

        // 3. 调用底层服务
        return sessionService.queryTemplateSessions(request);

    }

    /**
     * 根据会话ID查询模板详情
     * <p>
     * 获取指定会话的模板详情信息，包括会话信息、模板扩展信息和聊天记录。 只有平台管理员才能执行此操作。
     * </p>
     *
     * @param sessionId 会话ID
     * @return 模板详情
     * @throws BdpRuntimeException 当操作失败时抛出
     */
    public TemplateSessionDetailResponseDto getTemplateSessionDetail(Long sessionId) {
        log.info("开始查询会话模板详情 - sessionId: {}, userId: {}", sessionId, CurrentUserHolder.getCurrentUserId());

        try {
            // 1. 参数校验
            validateSessionId(sessionId);

            return sessionService.getTemplateSessionDetail(sessionId);

        }
        catch (BdpRuntimeException e) {
            log.error("会话模板详情查询失败 - sessionId: {}, error: {}", sessionId, e.getMessage());
            throw e;
        }
        catch (Exception e) {
            log.error("会话模板详情查询异常 - sessionId: {}, error: {}", sessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.session.detail.error", e.getMessage()));
        }
    }

    /**
     * 验证保存模板参数
     *
     * @param sessionId 会话ID
     * @param request 保存请求
     */
    private void validateSaveTemplateParameters(Long sessionId, TemplateSessionSaveRequestDto request) {
        // 1. 基础参数验证
        if (sessionId == null || sessionId <= 0) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.session.id.invalid"));
        }

        if (request == null) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.request.null"));
        }

        // 2. 模板标题验证
        validateTemplateTitle(request.getTemplateTitle());

        // 3. 模板类型验证
        validateTemplateType(request.getTemplateType());

        // 4. 封面ID验证
        validateCoverId(request.getCoverId());

        log.debug("保存模板参数校验通过 - sessionId: {}, templateType: {}, title: {}", sessionId, request.getTemplateType(),
            request.getTemplateTitle());
    }

    /**
     * 验证模板标题
     *
     * @param templateTitle 模板标题
     */
    private void validateTemplateTitle(String templateTitle) {
        if (templateTitle == null || templateTitle.trim().isEmpty()) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.title.required"));
        }

        // 去除首尾空格后验证长度
        String trimmedTitle = templateTitle.trim();
        if (trimmedTitle.length() > 100) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.title.too.long", "100"));
        }

        // 验证是否包含非法字符（可选）
        if (containsInvalidCharacters(trimmedTitle)) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.title.invalid.characters"));
        }
    }

    /**
     * 验证模板类型
     *
     * @param templateType 模板类型
     */
    private void validateTemplateType(String templateType) {
        if (templateType == null || templateType.trim().isEmpty()) {
            throw new BdpRuntimeException(I18nUtil.get("template.type.invalid"));
        }

        if (!TemplateTypeEnum.isValid(templateType.trim())) {
            throw new BdpRuntimeException(
                I18nUtil.get("template.session.type.invalid", templateType, TemplateTypeEnum.getAllCodesAsString()));
        }
    }

    /**
     * 验证封面ID
     *
     * @param coverId 封面ID
     */
    private void validateCoverId(Long coverId) {
        if (coverId == null || coverId <= 0) {
            throw new BdpRuntimeException(I18nUtil.get("template.cover.id.invalid"));
        }
    }

    /**
     * 检查标题是否包含非法字符
     *
     * @param title 标题
     * @return 是否包含非法字符
     */
    private boolean containsInvalidCharacters(String title) {
        // 检查是否包含HTML标签
        if (title.contains("<") || title.contains(">")) {
            return true;
        }

        // 检查是否包含脚本标签
        if (title.toLowerCase().contains("<script") || title.toLowerCase().contains("javascript:")) {
            return true;
        }

        // 可以添加更多非法字符检查
        return false;
    }

    /**
     * 验证查询模板参数
     *
     * @param request 查询请求
     */
    private void validateQueryTemplateParameters(TemplateSessionQueryRequestDto request) {
        if (request == null) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.query.request.null"));
        }

        // 验证分页参数
        if (request.getPageNum() != null && request.getPageNum() <= 0) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.page.num.invalid"));
        }
        if (request.getPageSize() != null && (request.getPageSize() <= 0 || request.getPageSize() > 100)) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.page.size.invalid"));
        }

        // 验证模板类型（如果提供）
        if (request.getTemplateTypes() != null && !request.getTemplateTypes().trim().isEmpty()) {
            String[] types = request.getTemplateTypes().split(",");
            for (String type : types) {
                if (!TemplateTypeEnum.isValid(type.trim())) {
                    throw new BdpRuntimeException(I18nUtil.get("template.session.type.invalid", type.trim(),
                        TemplateTypeEnum.getAllCodesAsString()));
                }
            }
        }

        // 验证关键字长度（如果提供）
        if (request.getKeyword() != null && request.getKeyword().length() > 50) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.keyword.too.long", "50"));
        }

        // 验证排序字段（如果提供）
        if (request.getSortField() != null && !isValidSortField(request.getSortField())) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.sort.field.invalid", request.getSortField(),
                "createTime, updateTime, sessionName"));
        }

        // 验证排序方向（如果提供）
        if (request.getSortOrder() != null && !isValidSortOrder(request.getSortOrder())) {
            throw new BdpRuntimeException(
                I18nUtil.get("template.session.sort.order.invalid", request.getSortOrder(), "asc, desc"));
        }

        log.debug("查询模板参数校验通过");
    }

    /**
     * 验证会话ID
     *
     * @param sessionId 会话ID
     */
    private void validateSessionId(Long sessionId) {
        if (sessionId == null || sessionId <= 0) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.session.id.invalid"));
        }

        log.debug("会话ID校验通过 - sessionId: {}", sessionId);
    }

    /**
     * 验证平台管理员权限
     *
     * @throws BdpRuntimeException 当用户不是平台管理员时抛出
     */
    private void validatePlatformAdminPermission() {
        // 这里需要根据实际的用户权限体系来实现
        log.debug("平台管理员权限验证通过 - userId: {}", CurrentUserHolder.getCurrentUserId());
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BdpRuntimeException(I18nUtil.get("template.session.permission.denied.not.platform.admin"));
        }
    }

    /**
     * 验证业务规则
     *
     * @param sessionId 会话ID
     * @param request 保存请求
     */
    private void validateBusinessRules(Long sessionId, TemplateSessionSaveRequestDto request) {
        // 1. 检查会话是否存在
        validateSessionExists(sessionId);

        // 2. 检查会话类型是否为非群聊
        validateSessionType(sessionId);

        log.debug("业务规则验证通过 - sessionId: {}", sessionId);
    }

    /**
     * 验证会话是否存在
     *
     * @param sessionId 会话ID
     */
    private void validateSessionExists(Long sessionId) {
        try {
            ByaiSession byaiSession = sessionService.findById(sessionId);
            // 验证会话是否存在
            if (byaiSession == null) {
                throw new BdpRuntimeException(I18nUtil.get("template.session.not.exists", sessionId));
            }
            log.debug("会话存在性验证通过 - sessionId: {}", sessionId);
        }
        catch (Exception e) {
            log.error("验证会话存在性失败 - sessionId: {}, error: {}", sessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.session.not.exists", sessionId));
        }
    }

    /**
     * 验证会话类型是否为非群聊
     *
     * @param sessionId 会话ID
     */
    private void validateSessionType(Long sessionId) {
        try {
            // 获取会话信息
            ByaiSession byaiSession = sessionService.findById(sessionId);
            if (byaiSession == null) {
                throw new BdpRuntimeException(I18nUtil.get("template.session.not.exists", sessionId));
            }

            String sessionType = byaiSession.getSessionType();

            // 检查会话类型是否为群聊
            if (SessionType.HS_AS.getCode().equals(sessionType)) {
                log.error("群聊会话不能保存为模板 - sessionId: {}, sessionType: {}", sessionId, sessionType);
                throw new BdpRuntimeException(
                    I18nUtil.get("template.session.type.group.chat.not.allowed", sessionId, sessionType));
            }

            // 验证会话类型是否有效
            boolean isValidType = SessionType.H_AS.getCode().equals(sessionType)
                || SessionType.H_H.getCode().equals(sessionType);
            if (!isValidType) {
                log.error("不支持的会话类型 - sessionId: {}, sessionType: {}", sessionId, sessionType);
                throw new BdpRuntimeException(
                    I18nUtil.get("template.session.type.not.supported", sessionId, sessionType));
            }

            log.debug("会话类型验证通过 - sessionId: {}, sessionType: {}", sessionId, sessionType);
        }
        catch (BdpRuntimeException e) {
            throw e;
        }
        catch (Exception e) {
            log.error("验证会话类型失败 - sessionId: {}, error: {}", sessionId, e.getMessage(), e);
            throw new BdpRuntimeException(
                I18nUtil.get("template.session.type.validate.error", sessionId, e.getMessage()));
        }
    }

    /**
     * 设置查询条件
     *
     * @param request 查询请求
     */
    private void setupQueryConditions(TemplateSessionQueryRequestDto request) {
        // TODO: 设置查询条件
        // 设置当前用户和企业信息
        // request.setCreatorId(CurrentUserHolder.getCurrentUserId());
        // request.setEnterpriseId(CurrentUserHolder.getEnterpriseId());

        // 设置默认分页参数
        // if (request.getPageNum() == null) {
        // request.setPageNum(1);
        // }
        // if (request.getPageSize() == null) {
        // request.setPageSize(20);
        // }

        // 设置默认排序
        // if (request.getSortField() == null) {
        // request.setSortField("createTime");
        // }
        // if (request.getSortOrder() == null) {
        // request.setSortOrder("desc");
        // }

        log.debug("查询条件设置完成");
    }

    /**
     * 验证排序字段是否有效
     *
     * @param sortField 排序字段
     * @return 是否有效
     */
    private boolean isValidSortField(String sortField) {
        if (sortField == null || sortField.trim().isEmpty()) {
            return false;
        }

        String[] validFields = {
            "createTime", "updateTime", "sessionName"
        };
        for (String validField : validFields) {
            if (validField.equals(sortField.trim())) {
                return true;
            }
        }
        return false;
    }

    /**
     * 验证排序方向是否有效
     *
     * @param sortOrder 排序方向
     * @return 是否有效
     */
    private boolean isValidSortOrder(String sortOrder) {
        if (sortOrder == null || sortOrder.trim().isEmpty()) {
            return false;
        }

        String trimmedOrder = sortOrder.trim().toLowerCase();
        return "asc".equals(trimmedOrder) || "desc".equals(trimmedOrder);
    }

    /**
     * 编辑会话模板消息
     * <p>
     * 编辑指定会话模板中的消息内容。 只有平台管理员才能执行此操作。
     * </p>
     *
     * @param sessionId 会话ID
     * @param request 编辑请求
     * @throws BdpRuntimeException 当操作失败时抛出
     */
    public void editTemplateMessage(Long sessionId, TemplateMessageEditRequestDto request) {
        log.info("开始编辑会话模板消息 - sessionId: {}, userId: {}, request: {}", sessionId,
            CurrentUserHolder.getCurrentUserId(), request);

        try {
            // 1. 参数校验
            validateEditTemplateMessageParameters(sessionId, request);

            // 2. 权限验证
            validatePlatformAdminPermission();

            // 3. 调用底层服务
            sessionService.editTemplateMessage(sessionId, request);

        }
        catch (BdpRuntimeException e) {
            log.error("会话模板消息编辑失败 - sessionId: {}, error: {}", sessionId, e.getMessage());
            throw e;
        }
        catch (Exception e) {
            log.error("会话模板消息编辑异常 - sessionId: {}, error: {}", sessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.message.edit.error", e.getMessage()));
        }
    }

    /**
     * 删除模板会话
     * <p>
     * 删除指定的模板会话，包括： 1. 清理成果空间数据（任务、文件、关联关系等） 2. 删除模板会话基本信息、消息、成员 3. 只有平台管理员才能执行此操作
     * </p>
     *
     * @param sessionId 模板会话ID
     * @return 删除结果
     * @throws BdpRuntimeException 当删除失败时抛出
     */
    public String deleteTemplateSession(Long sessionId) {
        try {
            log.info("开始删除模板会话 - sessionId: {}, userId: {}", sessionId, CurrentUserHolder.getCurrentUserId());

            // 1. 参数验证
            if (sessionId == null || sessionId <= 0) {
                throw new BdpRuntimeException(I18nUtil.get("template.session.session.id.invalid"));
            }

            // 2. 权限验证
            validatePlatformAdminPermission();

            // 3. 清理成果空间数据（参考回滚逻辑）
            log.info("开始清理成果空间数据 - sessionId: {}", sessionId);
            cleanupResultSpaceData(sessionId);
            log.info("成果空间数据清理完成 - sessionId: {}", sessionId);

            // 4. 删除模板会话（会级联删除基本信息、消息、成员）
            log.info("开始删除模板会话 - sessionId: {}", sessionId);
            sessionService.deleteTemplateSession(sessionId);
            log.info("模板会话删除成功 - sessionId: {}", sessionId);

            return "模板会话删除成功";

        }
        catch (Exception e) {
            log.error("删除模板会话失败 - sessionId: {}, error: {}", sessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.session.delete.error"));
        }
    }

    /**
     * 验证编辑模板消息参数
     *
     * @param sessionId 会话ID
     * @param request 编辑请求
     * @throws BdpRuntimeException 当参数无效时抛出
     */
    private void validateEditTemplateMessageParameters(Long sessionId, TemplateMessageEditRequestDto request) {
        if (sessionId == null || sessionId <= 0) {
            throw new BdpRuntimeException(I18nUtil.get("session.id.invalid"));
        }

        if (request == null) {
            throw new BdpRuntimeException(I18nUtil.get("request.null"));
        }

        // 验证请求体中的sessionId与路径参数一致
        if (request.getSessionId() == null || !request.getSessionId().equals(sessionId)) {
            throw new BdpRuntimeException(I18nUtil.get("session.id.mismatch"));
        }

        if (request.getMessageId() == null || request.getMessageId() <= 0) {
            throw new BdpRuntimeException(I18nUtil.get("message.id.invalid"));
        }

        if (StrUtil.isBlank(request.getMessageContent())) {
            throw new BdpRuntimeException(I18nUtil.get("message.content.blank"));
        }

        // 验证消息内容长度
        if (request.getMessageContent().length() > 10000) {
            throw new BdpRuntimeException(I18nUtil.get("message.content.too.long", "10000"));
        }

        log.debug("编辑模板消息参数验证通过 - sessionId: {}, messageId: {}, contentLength: {}", sessionId, request.getMessageId(),
            request.getMessageContent().length());
    }

    /**
     * 判断模板是否已存在
     *
     * @param sessionId 会话ID
     * @return 是否存在模板
     */
    private boolean isTemplateExists(Long sessionId) {
        try {
            log.debug("检查模板是否存在 - sessionId: {}", sessionId);

            TemplateSessionDetailResponseDto templateSessionDetail = sessionService.getTemplateSessionDetail(sessionId);

            // 如果调用成功且返回了数据，说明模板已存在
            boolean exists = templateSessionDetail.getSessionInfo() != null;

            log.debug("模板存在性检查结果 - sessionId: {}, exists: {}", sessionId, exists);
            return exists;

        }
        catch (Exception e) {
            log.debug("模板存在性检查异常，视为不存在 - sessionId: {}, error: {}", sessionId, e.getMessage());
            // 如果查询异常，视为模板不存在，走新增流程
            return false;
        }
    }

    /**
     * 更新模板会话
     *
     * @param sessionId 会话ID
     * @param request 更新请求
     * @return 更新结果
     * @throws BdpRuntimeException 当更新失败时抛出
     */
    private Long updateTemplate(Long sessionId, TemplateSessionSaveRequestDto request) {
        try {
            log.info("开始更新模板会话 - sessionId: {}, request: {}", sessionId, request);

            // 构建更新请求DTO
            TemplateUpdateRequestDto updateRequest = TemplateUpdateRequestDto.builder()
                .templateTitle(request.getTemplateTitle()).templateType(request.getTemplateType())
                .coverId(request.getCoverId()).templateConfig(request.getTemplateConfig())
                .terminal(request.getTerminal()).build();

            // 调用底层服务更新模板
            Long templateSessionId = sessionService.updateTemplate(sessionId, updateRequest);

            log.info("模板会话更新成功 - sessionId: {}, result: {}", sessionId, templateSessionId);
            return templateSessionId;

        }
        catch (BdpRuntimeException e) {
            log.error("模板会话更新失败 - sessionId: {}, error: {}", sessionId, e.getMessage());
            throw e;
        }
        catch (Exception e) {
            log.error("模板会话更新异常 - sessionId: {}, error: {}", sessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.session.update.error", e.getMessage()));
        }
    }

    /**
     * 获取会话消息列表
     *
     * @param sessionId 会话ID
     * @param messageIds 指定的消息ID列表，如果为空则获取所有消息
     * @return 消息列表
     * @throws BdpRuntimeException 当获取失败时抛出
     */
    private List<ByaiMessageHotDto> getSessionMessages(Long sessionId, List<Long> messageIds) {
        try {
            log.debug("获取会话消息列表 - sessionId: {}, messageIds: {}", sessionId, messageIds);

            // 如果指定了消息ID列表，则只获取指定的消息
            if (messageIds != null && !messageIds.isEmpty()) {
                return getSpecificMessages(sessionId, messageIds);
            }

            // 否则获取所有消息
            return getAllSessionMessages(sessionId);

        }
        catch (Exception e) {
            log.error("获取会话消息列表失败 - sessionId: {}, error: {}", sessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.session.get.messages.error", e.getMessage()));
        }
    }

    /**
     * 获取指定的消息列表
     *
     * @param sessionId 会话ID
     * @param messageIds 消息ID列表
     * @return 消息列表
     * @throws BdpRuntimeException 当获取失败时抛出
     */
    private List<ByaiMessageHotDto> getSpecificMessages(Long sessionId, List<Long> messageIds) {
        try {
            log.debug("获取指定消息列表 - sessionId: {}, messageIds: {}", sessionId, messageIds);

            // 临时实现：分页获取所有消息，然后过滤出指定的消息
            // TODO: 如果FeignMessageService有批量获取消息的接口，应该使用该接口以提高效率
            List<ByaiMessageHotDto> allMessages = getAllSessionMessages(sessionId);
            List<ByaiMessageHotDto> specificMessages = new ArrayList<>();

            for (ByaiMessageHotDto message : allMessages) {
                if (messageIds.contains(message.getMessageId())) {
                    specificMessages.add(message);
                }
            }

            log.info("获取指定消息列表成功 - sessionId: {}, 请求数量: {}, 实际获取数量: {}", sessionId, messageIds.size(),
                specificMessages.size());
            return specificMessages;

        }
        catch (Exception e) {
            log.error("获取指定消息列表失败 - sessionId: {}, messageIds: {}, error: {}", sessionId, messageIds, e.getMessage(),
                e);
            throw new BdpRuntimeException(I18nUtil.get("template.session.get.specific.messages.error", e.getMessage()));
        }
    }

    /**
     * 获取会话的所有消息列表
     *
     * @param sessionId 会话ID
     * @return 消息列表
     * @throws BdpRuntimeException 当获取失败时抛出
     */
    private List<ByaiMessageHotDto> getAllSessionMessages(Long sessionId) {
        log.info("获取会话所有消息列表 - sessionId: {}", sessionId);
        MessageHotQo messageHotQo = new MessageHotQo();
        messageHotQo.setSessionId(sessionId);
        List<ByaiMessageHotDto> allMessages = byaiMessageHotService.findByQo(messageHotQo);
        log.info("获取会话所有消息列表成功 - sessionId: {}, 消息数量: {}", sessionId, allMessages.size());
        return allMessages;

    }

    /**
     * 保存模板会话基本信息
     *
     * @param sessionId 原会话ID
     * @param request 保存请求
     * @return 模板会话ID
     * @throws BdpRuntimeException 当保存失败时抛出
     */
    private Long saveTemplateSessionBasicInfo(Long sessionId, TemplateSessionSaveRequestDto request) {
        try {
            log.debug("保存模板会话基本信息 - sessionId: {}, request: {}", sessionId, request);

            // 构建Feign请求DTO
            TemplateSaveRequestDto feignRequest = TemplateSaveRequestDto.builder()
                .templateTitle(request.getTemplateTitle()).templateType(request.getTemplateType())
                .coverId(request.getCoverId()).templateConfig(request.getTemplateConfig())
                .terminal(request.getTerminal()).newSessionId(sequenceService.nextVal()).build();

            // 调用底层服务保存模板会话基本信息
            Long templateSessionId = sessionService.saveAsTemplate(sessionId, feignRequest);

            log.info("模板会话基本信息保存成功 - sessionId: {}, templateSessionId: {}", sessionId, templateSessionId);
            return templateSessionId;

        }
        catch (Exception e) {
            log.error("保存模板会话基本信息失败 - sessionId: {}, error: {}", sessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.session.save.basic.info.error", e.getMessage()));
        }
    }

    /**
     * 复制模板会话消息
     *
     * @param templateSessionId 模板会话ID
     * @param originalSessionId 原会话ID
     * @param fileMappings 文件映射关系
     * @param messageIds 指定的消息ID列表，如果为空则复制所有消息
     * @throws BdpRuntimeException 当复制失败时抛出
     */
    private void copyTemplateMessages(Long templateSessionId, Long originalSessionId,
        Map<String, TemplateMessagesCopyRequestDto.FileInfo> fileMappings, List<Long> messageIds) {

        try {
            log.debug("复制模板会话消息 - templateSessionId: {}, originalSessionId: {}, fileMappings: {}, messageIds: {}",
                templateSessionId, originalSessionId, fileMappings, messageIds);

            // 构建复制请求DTO
            TemplateMessagesCopyRequestDto copyRequest = TemplateMessagesCopyRequestDto.builder()
                .originalSessionId(originalSessionId).messageIds(messageIds) // 添加指定的消息ID列表
                .fileMappings(fileMappings).build();

            // 调用底层服务复制消息
            sessionService.copyTemplateMessages(templateSessionId, copyRequest);

        }
        catch (Exception e) {
            log.error("复制模板会话消息失败 - templateSessionId: {}, originalSessionId: {}, error: {}", templateSessionId,
                originalSessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.session.copy.messages.error", e.getMessage()));
        }
    }

    /**
     * 复制模板会话成员
     *
     * @param templateSessionId 模板会话ID
     * @param originalSessionId 原会话ID
     * @throws BdpRuntimeException 当复制失败时抛出
     */
    private void copyTemplateMembers(Long templateSessionId, Long originalSessionId) {
        try {
            log.debug("复制模板会话成员 - templateSessionId: {}, originalSessionId: {}", templateSessionId, originalSessionId);

            // 1. 获取原会话的成员列表
            List<ByaiSessionMember> originalMembers = sessionMemberService.findSessionMembers(originalSessionId, null,
                null);

            if (originalMembers.isEmpty()) {
                log.info("原会话没有成员，跳过成员复制 - originalSessionId: {}", originalSessionId);
                return;
            }

            // 2. 构建成员映射关系（原用户ID -> 新用户ID）
            // 对于模板会话，我们直接使用原用户ID，不进行用户映射
            Map<Long, Long> memberMappings = new HashMap<>();
            for (ByaiSessionMember member : originalMembers) {
                Long menSessionMemberId = member.getByaiSessionMemberId();
                // 直接使用原用户ID作为新用户ID（不进行用户映射）
                memberMappings.put(menSessionMemberId, sequenceService.nextVal());
            }

            log.debug("构建成员映射关系 - 成员数量: {}, 映射关系: {}", originalMembers.size(), memberMappings);

            // 3. 构建复制请求DTO
            TemplateMembersCopyRequestDto copyRequest = TemplateMembersCopyRequestDto.builder()
                .originalSessionId(originalSessionId).sessionMemberIdMappings(memberMappings) // 提供成员映射关系
                .build();

            // 调用底层服务复制成员
            sessionService.copyTemplateMembers(templateSessionId, copyRequest);

        }
        catch (Exception e) {
            log.error("复制模板会话成员失败 - templateSessionId: {}, originalSessionId: {}, error: {}", templateSessionId,
                originalSessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.session.copy.members.error", e.getMessage()));
        }
    }

    /**
     * 复制成果空间数据
     *
     * @param templateSessionId 模板会话ID
     * @param originalSessionId 原会话ID
     * @throws BdpRuntimeException 当复制失败时抛出
     */
    private void copyResultSpaceData(Long templateSessionId, Long originalSessionId) {
        try {
            log.info("开始复制成果空间数据 - templateSessionId: {}, originalSessionId: {}", templateSessionId, originalSessionId);

            // 1. 复制任务数据
            List<Long> copiedTaskIds = copyTaskData(templateSessionId, originalSessionId);

            // 2. 复制知识库文件
            Map<String, String> fileIdMapping = copyKnowledgeFiles(templateSessionId, originalSessionId, copiedTaskIds);

            // 3. 更新任务与文件的关联关系
            updateTaskFileRelations(copiedTaskIds, fileIdMapping);

            log.info("成果空间数据复制完成 - templateSessionId: {}, 复制任务数: {}, 复制文件数: {}", templateSessionId,
                copiedTaskIds.size(), fileIdMapping.size());

        }
        catch (Exception e) {
            log.error("复制成果空间数据失败 - templateSessionId: {}, originalSessionId: {}, error: {}", templateSessionId,
                originalSessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.result.space.copy.error", e.getMessage()));
        }
    }

    /**
     * 复制任务数据
     *
     * @param templateSessionId 模板会话ID
     * @param originalSessionId 原会话ID
     * @return 复制后的任务ID列表
     * @throws BdpRuntimeException 当复制失败时抛出
     */
    @Transactional(rollbackFor = Exception.class)
    protected List<Long> copyTaskData(Long templateSessionId, Long originalSessionId) {
        try {
            log.info("开始复制任务数据 - templateSessionId: {}, originalSessionId: {}", templateSessionId, originalSessionId);

            // 1. 查询原会话的所有任务
            List<MenTaskVo> originalTasks = getOriginalSessionTasks(originalSessionId);

            if (originalTasks == null || originalTasks.isEmpty()) {
                log.info("原会话没有任务数据，跳过任务复制 - originalSessionId: {}", originalSessionId);
                return new ArrayList<>();
            }

            // 2. 建立任务ID映射关系（原任务ID -> 新任务ID）
            Map<Long, Long> taskIdMapping = new HashMap<>();
            List<Long> copiedTaskIds = new ArrayList<>();

            // 3. 按层级复制任务：先复制父任务，再复制子任务
            List<MenTaskVo> parentTasks = new ArrayList<>();
            List<MenTaskVo> childTasks = new ArrayList<>();

            // 3.1 分离父任务和子任务
            for (MenTaskVo originalTask : originalTasks) {
                if (originalTask.getPTaskId() == null) {
                    parentTasks.add(originalTask); // 父任务
                }
                else {
                    childTasks.add(originalTask); // 子任务
                }
            }

            // 3.2 先复制所有父任务
            for (MenTaskVo originalTask : parentTasks) {
                try {
                    Long newTaskId = copySingleTask(originalTask, templateSessionId, null, taskIdMapping);
                    copiedTaskIds.add(newTaskId);
                    log.debug("父任务复制成功 - originalTaskId: {}, newTaskId: {}", originalTask.getTaskId(), newTaskId);
                }
                catch (Exception e) {
                    log.error("复制父任务失败 - originalTaskId: {}, error: {}", originalTask.getTaskId(), e.getMessage(), e);
                    throw new BdpRuntimeException(I18nUtil.get("template.task.copy.parent.failed", e.getMessage()), e);
                }
            }

            // 3.3 再复制所有子任务
            for (MenTaskVo originalTask : childTasks) {
                try {
                    // 获取父任务的新ID
                    Long newParentTaskId = taskIdMapping.get(originalTask.getPTaskId());
                    if (newParentTaskId == null) {
                        log.warn("子任务的父任务未找到 - originalTaskId: {}, originalParentTaskId: {}", originalTask.getTaskId(),
                            originalTask.getPTaskId());
                        continue; // 跳过这个子任务
                    }

                    Long newTaskId = copySingleTask(originalTask, templateSessionId, newParentTaskId, taskIdMapping);
                    copiedTaskIds.add(newTaskId);
                    log.debug("子任务复制成功 - originalTaskId: {}, newTaskId: {}, newParentTaskId: {}",
                        originalTask.getTaskId(), newTaskId, newParentTaskId);
                }
                catch (Exception e) {
                    log.error("复制子任务失败 - originalTaskId: {}, error: {}", originalTask.getTaskId(), e.getMessage(), e);
                    throw new BdpRuntimeException(I18nUtil.get("template.task.copy.child.failed", e.getMessage()), e);
                }
            }

            // 4. 批量复制任务目录和状态日志
            log.info("开始批量复制任务目录 - templateSessionId: {}", templateSessionId);
            batchCopyTaskCatalogs(originalTasks, taskIdMapping);
            log.info("任务目录复制完成 - templateSessionId: {}", templateSessionId);

            log.info("任务数据复制完成 - templateSessionId: {}, 原任务数: {}, 复制成功数: {}, 父任务数: {}, 子任务数: {}", templateSessionId,
                originalTasks.size(), copiedTaskIds.size(), parentTasks.size(), childTasks.size());

            return copiedTaskIds;

        }
        catch (Exception e) {
            log.error("复制任务数据失败 - templateSessionId: {}, originalSessionId: {}, error: {}", templateSessionId,
                originalSessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.task.copy.error", e.getMessage()));
        }
    }

    /**
     * 复制知识库文件
     *
     * @param templateSessionId 模板会话ID
     * @param originalSessionId 原会话ID
     * @param taskIds 任务ID列表
     * @return 文件ID映射关系
     * @throws BdpRuntimeException 当复制失败时抛出
     */
    private Map<String, String> copyKnowledgeFiles(Long templateSessionId, Long originalSessionId, List<Long> taskIds) {
        try {
            log.info("开始复制知识库文件 - templateSessionId: {}, originalSessionId: {}, taskIds: {}", templateSessionId,
                originalSessionId, taskIds);

            Map<String, String> fileIdMapping = new HashMap<>();

            // 1. 查询原会话的所有文件
            List<Map<String, Object>> originalFiles = searchOriginalSessionFiles(originalSessionId);

            if (originalFiles == null || originalFiles.isEmpty()) {
                log.info("原会话没有知识库文件，跳过文件复制 - originalSessionId: {}", originalSessionId);
                return fileIdMapping;
            }

            for (Map<String, Object> file : originalFiles) {

                String originalFileId = MapUtil.getStr(file, "fileId");
                String fileName = MapUtil.getStr(file, "fileName");

                // 使用 Hutool 工具处理逗号分隔的标签字符串
                String tagsStr = MapUtil.getStr(file, "tags");
                List<String> originalTags = new ArrayList<>();
                if (StrUtil.isNotBlank(tagsStr)) {
                    // 使用 Hutool 的 StrUtil.split 方法分割标签字符串
                    originalTags = StrUtil.split(tagsStr, ',', true, true);
                }

                if (StringUtils.isBlank(originalFileId)) {
                    log.warn("文件ID为空，跳过文件复制 - fileName: {}", fileName);
                    continue;
                }

                // 2. 下载原文件 - 使用TemplateFileProcessingService的下载方法
                try (Response downloadResponse = templateFileProcessingService
                    .downloadFile(Long.valueOf(originalFileId));) {

                    // 3. 重新上传到新模板（所有标签在上传前构建，参考原逻辑）
                    String newFileId = uploadFileToTemplate(downloadResponse, templateSessionId, fileName, taskIds,
                        originalTags);

                    fileIdMapping.put(originalFileId, newFileId);

                    log.debug("文件复制成功 - originalFileId: {}, newFileId: {}, fileName: {}, originalTags: {}",
                        originalFileId, newFileId, fileName, originalTags);

                }
                catch (Exception e) {
                    log.error("复制文件失败 - fileName: {}, error: {}", file.get("fileName"), e.getMessage(), e);
                    // 继续处理其他文件，不中断整个流程
                }
            }

            log.info("知识库文件复制完成 - templateSessionId: {}, 原文件数: {}, 复制成功数: {}", templateSessionId, originalFiles.size(),
                fileIdMapping.size());

            return fileIdMapping;

        }
        catch (Exception e) {
            log.error("复制知识库文件失败 - templateSessionId: {}, originalSessionId: {}, error: {}", templateSessionId,
                originalSessionId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.knowledge.files.copy.error", e.getMessage()));
        }
    }

    /**
     * 更新任务与文件的关联关系
     *
     * @param taskIds 任务ID列表
     * @param fileIdMapping 文件ID映射关系
     * @throws BdpRuntimeException 当更新失败时抛出
     */
    private void updateTaskFileRelations(List<Long> taskIds, Map<String, String> fileIdMapping) {
        try {
            log.info("开始更新任务与文件关联关系 - taskIds: {}, fileIdMapping: {}", taskIds, fileIdMapping);

            if (taskIds == null || taskIds.isEmpty() || fileIdMapping == null || fileIdMapping.isEmpty()) {
                log.info("没有任务或文件需要更新关联关系");
                return;
            }

            // 这里可以根据具体需求实现任务与文件的关联关系更新
            // 例如：更新任务中的文件引用、更新资源组件中的文件ID等

            log.info("任务与文件关联关系更新完成 - 任务数: {}, 文件映射数: {}", taskIds.size(), fileIdMapping.size());

        }
        catch (Exception e) {
            log.error("更新任务与文件关联关系失败 - taskIds: {}, fileIdMapping: {}, error: {}", taskIds, fileIdMapping,
                e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.task.file.relations.update.error", e.getMessage()));
        }
    }

    /**
     * 清理成果空间数据
     *
     * @param templateSessionId 模板会话ID
     * @throws BdpRuntimeException 当清理失败时抛出
     */
    private void cleanupResultSpaceData(Long templateSessionId) {
        try {
            log.info("开始清理成果空间数据 - templateSessionId: {}", templateSessionId);

            // 1. 查询模板会话的所有任务
            List<MenTaskVo> templateTasks = getTemplateSessionTasks(templateSessionId);

            if (templateTasks.isEmpty()) {
                log.info("模板会话没有任务数据，跳过清理 - templateSessionId: {}", templateSessionId);
                return;
            }

            for (MenTaskVo task : templateTasks) {
                try {
                    // 2. 删除任务相关的文件
                    deleteTaskFiles(task.getTaskId());
                    // 3. 删除任务接收对象
                    deleteTaskReceivers(task.getTaskId());
                    // 4. 删除任务目录
                    deleteTaskCatalogs(task.getTaskId());
                    // 5. 删除资源组件
                    if (task.getResComId() != null) {
                        deleteResourceComponent(task.getResComId());
                    }
                    // 6. 删除任务
                    deleteTask(task.getTaskId());

                    log.debug("任务清理成功 - taskId: {}", task.getTaskId());
                }
                catch (Exception e) {
                    log.error("清理任务失败 - taskId: {}, error: {}", task.getTaskId(), e.getMessage(), e);
                    // 继续清理其他任务，不中断
                }
            }

            log.info("成果空间数据清理完成 - templateSessionId: {}, 清理任务数: {}", templateSessionId, templateTasks.size());

        }
        catch (Exception e) {
            log.error("清理成果空间数据失败 - templateSessionId: {}, error: {}", templateSessionId, e.getMessage(), e);
            throw e;
        }
    }

    // ==================== 辅助方法实现 ====================

    /**
     * 获取原会话的所有任务（修复bug后，父任务和子任务都有sessionId）
     */
    private List<MenTaskVo> getOriginalSessionTasks(Long originalSessionId) {
        try {
            log.debug("获取原会话任务 - originalSessionId: {}", originalSessionId);

            // 直接通过sessionId查询所有任务（包括父任务和子任务）
            MenTaskQueryQo sessionQueryQo = new MenTaskQueryQo();
            sessionQueryQo.setSessionId(originalSessionId);
            sessionQueryQo.setPageNum(1);
            sessionQueryQo.setPageSize(1000);

            PageInfo<MenTaskVo> sessionPageInfo = menTaskService.listTasksByPage(sessionQueryQo);
            List<MenTaskVo> allTasks = sessionPageInfo != null ? sessionPageInfo.getList() : new ArrayList<>();

            log.info("获取原会话任务成功 - originalSessionId: {}, 总任务数量: {}", originalSessionId, allTasks.size());
            return allTasks;

        }
        catch (Exception e) {
            log.error("获取原会话任务失败 - originalSessionId: {}, error: {}", originalSessionId, e.getMessage(), e);
            return new ArrayList<>();
        }
    }

    /**
     * 获取模板会话的所有任务
     */
    private List<MenTaskVo> getTemplateSessionTasks(Long templateSessionId) {
        try {
            log.debug("获取模板会话任务 - templateSessionId: {}", templateSessionId);

            // 构建查询条件
            MenTaskQueryQo queryQo = new MenTaskQueryQo();
            queryQo.setSessionId(templateSessionId);
            queryQo.setPageNum(1);
            queryQo.setPageSize(1000); // 设置一个较大的页面大小来获取所有任务

            // 调用MenTaskService查询任务列表
            PageInfo<MenTaskVo> pageInfo = menTaskService.listTasksByPage(queryQo);

            List<MenTaskVo> tasks = pageInfo != null ? pageInfo.getList() : new ArrayList<>();

            log.info("获取模板会话任务成功 - templateSessionId: {}, 任务数量: {}", templateSessionId, tasks.size());
            return tasks;

        }
        catch (Exception e) {
            log.error("获取模板会话任务失败 - templateSessionId: {}, error: {}", templateSessionId, e.getMessage(), e);
            return new ArrayList<>();
        }
    }

    /**
     * 复制单个任务（包含父子关系处理）
     */
    private Long copySingleTask(MenTaskVo originalTask, Long templateSessionId, Long newParentTaskId,
        Map<Long, Long> taskIdMapping) {
        try {
            // 1. 复制任务基本信息
            MenTask newTask = copyTaskBasicInfo(originalTask, templateSessionId, newParentTaskId);

            // 2. 创建新任务
            Long newTaskId = createNewTask(newTask);

            // 3. 建立任务ID映射关系
            taskIdMapping.put(originalTask.getTaskId(), newTaskId);

            // 4. 复制资源组件
            if (originalTask.getResComId() != null) {
                Long newResComId = copyResourceComponent(originalTask.getResComId(), newTaskId);
                updateTaskResourceComponent(newTaskId, newResComId);
            }

            // 5. 复制任务接收对象
            copyTaskReceivers(originalTask.getTaskId(), newTaskId);

            return newTaskId;
        }
        catch (Exception e) {
            log.error("复制单个任务失败 - originalTaskId: {}, error: {}", originalTask.getTaskId(), e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.task.copy.single.failed", e.getMessage()));
        }
    }

    /**
     * 复制任务基本信息
     */
    private MenTask copyTaskBasicInfo(MenTaskVo originalTask, Long templateSessionId, Long newParentTaskId) {

        MenTask newTask = new MenTask();

        // 设置主键 - 使用序列服务生成新的任务ID
        newTask.setTaskId(sequenceService.nextVal());

        // 复制基本信息
        newTask.setTaskType(originalTask.getTaskType());
        newTask.setTitle(originalTask.getTitle());
        newTask.setContent(originalTask.getContent());
        newTask.setFileOutType(originalTask.getFileOutType());
        newTask.setFileOut(originalTask.getFileOut());
        newTask.setTaskDealineTime(originalTask.getTaskDealineTime());
        newTask.setSendType(originalTask.getSendType());
        newTask.setSendObjId(originalTask.getSendObjId());
        newTask.setDealType(originalTask.getDealType());
        newTask.setDealObjId(originalTask.getDealObjId());
        newTask.setDealDesc(originalTask.getDealDesc());
        newTask.setSessionId(templateSessionId); // 使用新的模板会话ID
        newTask.setMessageId(originalTask.getMessageId());
        newTask.setMessageStepCode(originalTask.getMessageStepCode());
        newTask.setStatusCd(originalTask.getStatusCd());
        newTask.setPriority(originalTask.getPriority());
        newTask.setPageId(originalTask.getPageId());
        newTask.setSystemNo(originalTask.getSystemNo());
        newTask.setLoadSsoIframeUrl(originalTask.getLoadSsoIframeUrl());

        // 设置父任务ID（重要：处理任务层级关系）
        newTask.setPTaskId(newParentTaskId);

        newTask.setCreateBy(originalTask.getCreateBy());
        newTask.setCreateTime(originalTask.getCreateTime());
        newTask.setUpdateBy(originalTask.getUpdateBy());
        newTask.setUpdateTime(originalTask.getUpdateTime());
        newTask.setComAcctId(CurrentUserHolder.getEnterpriseId());

        return newTask;
    }

    /**
     * 创建新任务
     */
    private Long createNewTask(MenTask newTask) {
        try {
            int result = menTaskMapper.insert(newTask);
            if (result > 0) {
                return newTask.getTaskId();
            }
            else {
                throw new BdpRuntimeException(I18nUtil.get("template.task.create.failed"));
            }
        }
        catch (Exception e) {
            log.error("创建新任务失败 - error: {}", e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.task.create.new.failed", e.getMessage()));
        }
    }

    /**
     * 复制资源组件
     */
    private Long copyResourceComponent(Long originalResComId, Long newTaskId) {
        try {
            log.debug("复制资源组件 - originalResComId: {}, newTaskId: {}", originalResComId, newTaskId);

            // 1. 查询原资源组件
            MenResCom originalResCom = menResComMapper.selectById(originalResComId);
            if (originalResCom == null) {
                log.warn("原资源组件不存在 - originalResComId: {}", originalResComId);
                return null;
            }

            // 2. 创建新的资源组件
            MenResCom newResCom = new MenResCom();

            // 设置主键 - 使用序列服务生成新的资源组件ID
            newResCom.setResComId(sequenceService.nextVal());

            newResCom.setResType(originalResCom.getResType());
            newResCom.setResPage(originalResCom.getResPage()); // 复制构建内容JSON
            newResCom.setCreateBy(originalResCom.getCreateBy());
            newResCom.setCreateTime(originalResCom.getCreateTime());
            newResCom.setUpdateBy(originalResCom.getCreateBy());
            newResCom.setUpdateTime(originalResCom.getUpdateTime());
            newResCom.setComAcctId(CurrentUserHolder.getEnterpriseId());

            // 3. 插入新的资源组件
            int result = menResComMapper.insert(newResCom);
            if (result > 0) {
                log.debug("资源组件复制成功 - originalResComId: {}, newResComId: {}", originalResComId,
                    newResCom.getResComId());
                return newResCom.getResComId();
            }
            else {
                throw new BdpRuntimeException(I18nUtil.get("template.resource.component.insert.failed"));
            }

        }
        catch (Exception e) {
            log.error("复制资源组件失败 - originalResComId: {}, newTaskId: {}, error: {}", originalResComId, newTaskId,
                e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.resource.component.copy.failed", e.getMessage()));
        }
    }

    /**
     * 更新任务资源组件
     */
    private void updateTaskResourceComponent(Long taskId, Long resComId) {
        try {
            MenTask updateTask = new MenTask();
            updateTask.setTaskId(taskId);
            updateTask.setResComId(resComId);
            updateTask.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            updateTask.setUpdateTime(new Date());

            menTaskMapper.updateById(updateTask);
            log.debug("更新任务资源组件成功 - taskId: {}, resComId: {}", taskId, resComId);
        }
        catch (Exception e) {
            log.error("更新任务资源组件失败 - taskId: {}, resComId: {}, error: {}", taskId, resComId, e.getMessage(), e);
            throw new BdpRuntimeException(
                I18nUtil.get("template.task.resource.component.update.failed", e.getMessage()));
        }
    }

    /**
     * 批量复制任务目录
     *
     * @param originalTasks 原任务列表
     * @param taskIdMapping 任务ID映射关系
     */
    private void batchCopyTaskCatalogs(List<MenTaskVo> originalTasks, Map<Long, Long> taskIdMapping) {
        try {
            if (originalTasks == null || originalTasks.isEmpty() || taskIdMapping == null || taskIdMapping.isEmpty()) {
                log.info("没有任务需要复制目录和状态日志");
                return;
            }

            // 1. 批量查询原任务的所有目录
            List<Long> originalTaskIds = originalTasks.stream().map(MenTaskVo::getTaskId).collect(Collectors.toList());

            List<MenTaskCatalog> originalCatalogs = batchQueryTaskCatalogs(originalTaskIds);

            // 2. 批量构建新的目录数据
            List<MenTaskCatalog> newCatalogs = buildNewTaskCatalogs(originalCatalogs, taskIdMapping);

            // 3. 批量插入新数据
            if (!newCatalogs.isEmpty()) {
                batchInsertTaskCatalogs(newCatalogs);
                log.info("批量插入任务目录成功 - 数量: {}", newCatalogs.size());
            }
        }
        catch (Exception e) {
            log.error("批量复制任务目录和状态日志失败 - error: {}", e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.task.catalog.batch.copy.failed", e.getMessage()));
        }
    }

    /**
     * 批量查询任务目录
     */
    private List<MenTaskCatalog> batchQueryTaskCatalogs(List<Long> taskIds) {
        try {
            if (taskIds == null || taskIds.isEmpty()) {
                return new ArrayList<>();
            }

            LambdaQueryWrapper<MenTaskCatalog> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.in(MenTaskCatalog::getTaskId, taskIds);
            return menTaskCatalogMapper.selectList(queryWrapper);
        }
        catch (Exception e) {
            log.error("批量查询任务目录失败 - taskIds: {}, error: {}", taskIds, e.getMessage(), e);
            return new ArrayList<>();
        }
    }

    /**
     * 构建新的任务目录数据
     */
    private List<MenTaskCatalog> buildNewTaskCatalogs(List<MenTaskCatalog> originalCatalogs,
        Map<Long, Long> taskIdMapping) {
        List<MenTaskCatalog> newCatalogs = new ArrayList<>();

        for (MenTaskCatalog originalCatalog : originalCatalogs) {
            Long newTaskId = taskIdMapping.get(originalCatalog.getTaskId());
            if (newTaskId != null) {
                MenTaskCatalog newCatalog = new MenTaskCatalog();

                // 设置新的主键
                newCatalog.setTaskCatalogId(sequenceService.nextVal());

                // 复制基本信息
                newCatalog.setCataName(originalCatalog.getCataName());
                newCatalog.setPCatalogId(originalCatalog.getPCatalogId());
                newCatalog.setTaskId(newTaskId); // 使用新的任务ID

                // 设置创建信息
                newCatalog.setCreateBy(CurrentUserHolder.getCurrentUserId());
                newCatalog.setCreateTime(new Date());
                newCatalog.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                newCatalog.setUpdateTime(new Date());
                newCatalog.setComAcctId(CurrentUserHolder.getEnterpriseId());

                newCatalogs.add(newCatalog);
            }
        }

        return newCatalogs;
    }

    /**
     * 批量插入任务目录 - 真正的批量插入
     */
    private void batchInsertTaskCatalogs(List<MenTaskCatalog> catalogs) {
        try {
            if (catalogs == null || catalogs.isEmpty()) {
                return;
            }

            // 使用真正的批量插入SQL
            int result = menTaskCatalogMapper.batchInsert(catalogs);
            log.debug("批量插入任务目录成功 - 插入数量: {}, 影响行数: {}", catalogs.size(), result);
        }
        catch (Exception e) {
            log.error("批量插入任务目录失败 - error: {}", e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.task.catalog.batch.insert.failed", e.getMessage()));
        }
    }

    /**
     * 复制任务接收对象
     */
    private void copyTaskReceivers(Long originalTaskId, Long newTaskId) {
        try {
            log.debug("复制任务接收对象 - originalTaskId: {}, newTaskId: {}", originalTaskId, newTaskId);

            // 1. 查询原任务的所有接收对象
            List<MenTaskRecObj> originalReceivers = menTaskRecObjMapper.selectByTaskId(originalTaskId);

            if (originalReceivers == null || originalReceivers.isEmpty()) {
                log.debug("原任务没有接收对象 - originalTaskId: {}", originalTaskId);
                return;
            }

            // 2. 为每个接收对象创建新的记录
            for (MenTaskRecObj originalReceiver : originalReceivers) {
                MenTaskRecObj newReceiver = new MenTaskRecObj();

                // 设置主键 - 使用序列服务生成新地接收对象ID
                newReceiver.setTaskRecObjId(sequenceService.nextVal());

                newReceiver.setTaskId(newTaskId); // 使用新的任务ID
                newReceiver.setReciType(originalReceiver.getReciType());
                newReceiver.setReciObjId(originalReceiver.getReciObjId());
                newReceiver.setCreateBy(CurrentUserHolder.getCurrentUserId());
                newReceiver.setCreateTime(new Date());
                newReceiver.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                newReceiver.setUpdateTime(new Date());
                newReceiver.setComAcctId(CurrentUserHolder.getEnterpriseId());

                // 3. 插入新地接收对象记录
                int result = menTaskRecObjMapper.insert(newReceiver);
                if (result <= 0) {
                    log.warn("插入任务接收对象失败 - originalTaskId: {}, newTaskId: {}, reciType: {}, reciObjId: {}",
                        originalTaskId, newTaskId, originalReceiver.getReciType(), originalReceiver.getReciObjId());
                }
            }

            log.debug("任务接收对象复制完成 - originalTaskId: {}, newTaskId: {}, 复制数量: {}", originalTaskId, newTaskId,
                originalReceivers.size());

        }
        catch (Exception e) {
            log.error("复制任务接收对象失败 - originalTaskId: {}, newTaskId: {}, error: {}", originalTaskId, newTaskId,
                e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.task.receiver.copy.failed", e.getMessage()));
        }
    }

    /**
     * 搜索原会话的文件
     */
    private List<Map<String, Object>> searchOriginalSessionFiles(Long originalSessionId) {
        try {
            // 构建搜索请求
            Map<String, Object> request = new HashMap<>();
            request.put("chatId", originalSessionId.toString());
            request.put("tags", "SE_" + originalSessionId);
            request.put("matchMode", "all");

            KnowledgeResponse<Map<String, Object>> response = fileService.searchFilesByTags(request);

            if (response != null && response.getResultObject() != null) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> files = (List<Map<String, Object>>) response.getResultObject().get("files");
                return files;
            }

            return new ArrayList<>();
        }
        catch (Exception e) {
            log.error("搜索原会话文件失败 - originalSessionId: {}, error: {}", originalSessionId, e.getMessage(), e);
            return new ArrayList<>();
        }
    }

    /**
     * 上传文件到模板
     */
    private String uploadFileToTemplate(Response downloadResponse, Long templateSessionId, String fileName,
        List<Long> taskIds, List<String> originalTags) {
        try {
            String newFileName = templateSessionId + "_" + fileName;
            log.debug("上传文件到模板 - templateSessionId: {}, newFileName: {}", templateSessionId, newFileName);

            // 创建MultipartFile对象
            MultipartFile multipartFile = createMultipartFileFromResponse(downloadResponse, newFileName);

            // 使用fileService.uploadFiles上传文件（成果空间接口，根据开关适配不同系统）
            // 构建标签列表（参考原逻辑，在上传前构建所有标签）
            List<String> tags = new ArrayList<>();
            tags.add("US_" + CurrentUserHolder.getCurrentUserId()); // 用户标签
            tags.add("SE_" + templateSessionId); // 会话标签
            tags.add("NET_0"); // 网络标签

            // 添加任务标签
            if (taskIds != null && !taskIds.isEmpty()) {
                for (Long taskId : taskIds) {
                    tags.add("TA_" + taskId);
                }
            }

            // 添加目录标签（从原标签中提取）
            if (originalTags != null && !originalTags.isEmpty()) {
                for (String tag : originalTags) {
                    if (tag.startsWith("TC") && tag.contains("_")) {
                        tags.add(tag);
                    }
                }
            }

            // 获取项目ID
            Long projectId = Long
                .parseLong(byaiSystemConfigService.getDcSystemConfigValueByCode(Constants.AGENT_RESOURCE_PROJECT_ID));

            // 调用成果空间文件上传接口
            KnowledgeResponse<Map<String, Object>> uploadResponse = fileService.uploadFiles(new MultipartFile[] {
                multipartFile
            }, tags, templateSessionId, projectId, false // 不是临时文件
            );

            // 检查上传结果
            if (!Constants.RESPONSE_SUCCESS.equals(uploadResponse.getResultCode())) {
                log.error("文件上传失败 - templateSessionId: {}, response: {}", templateSessionId,
                    uploadResponse.getResultMsg());
                throw new BdpRuntimeException(
                    I18nUtil.get("template.file.upload.failed", templateSessionId, uploadResponse.getResultMsg()));
            }

            // 从响应中提取新文件ID
            String newFileId = extractNewFileIdFromUploadFilesResponse(uploadResponse);
            if (StringUtils.isBlank(newFileId)) {
                log.error("文件上传成功但无法获取新文件ID - templateSessionId: {}, response: {}", templateSessionId, uploadResponse);
                throw new BdpRuntimeException(I18nUtil.get("template.file.upload.no.file.id", templateSessionId));
            }

            // 上传成功后，添加FN_文件名标签（参考原逻辑，只有文件名标签在上传后添加）
            addFileNameTag(newFileId, newFileName);

            log.info("文件上传成功 - templateSessionId: {}, newFileId: {}", templateSessionId, newFileId);
            return newFileId;

        }
        catch (Exception e) {
            log.error("上传文件到模板失败 - templateSessionId: {}, fileName: {}, error: {}", templateSessionId, fileName,
                e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.file.upload.to.template.failed", e.getMessage()));
        }
    }

    /**
     * 更新文件标签
     */
    private void updateFileTags(String newFileId, Long templateSessionId, List<Long> taskIds, String fileName) {
        try {
            log.debug("更新文件标签 - newFileId: {}, templateSessionId: {}, taskIds: {}, fileName: {}", newFileId,
                templateSessionId, taskIds, fileName);

            // 构建标签列表
            List<String> tags = new ArrayList<>();
            tags.add("US_" + CurrentUserHolder.getCurrentUserId()); // 用户标签
            tags.add("SE_" + templateSessionId); // 会话标签
            tags.add("NET_1"); // 网络标签

            // 为每个任务添加任务标签
            if (taskIds != null && !taskIds.isEmpty()) {
                for (Long taskId : taskIds) {
                    tags.add("TA_" + taskId);
                }
            }

            // 添加文件名标签
            if (StringUtils.isNotBlank(fileName)) {
                tags.add("FN_" + fileName);
            }

            // 构建更新标签的请求
            Map<String, Object> request = new HashMap<>();
            request.put("fileId", newFileId);
            request.put("tags", String.join(",", tags));

            // 调用知识库服务添加文件标签
            KnowledgeResponse<List<Map<String, Object>>> response = fileService.addFileTagsBatch(request);

            if (response == null || !Constants.RESPONSE_SUCCESS.equals(response.getResultCode())) {
                log.warn("更新文件标签失败 - newFileId: {}, response: {}", newFileId,
                    response != null ? response.getResultMsg() : "null");
            }
            else {
                log.debug("文件标签更新成功 - newFileId: {}, tags: {}", newFileId, tags);
            }

        }
        catch (Exception e) {
            log.error("更新文件标签失败 - newFileId: {}, templateSessionId: {}, taskIds: {}, fileName: {}, error: {}",
                newFileId, templateSessionId, taskIds, fileName, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.file.tag.update.failed", e.getMessage()));
        }
    }

    /**
     * 删除任务文件
     */
    private void deleteTaskFiles(Long taskId) {
        try {
            // 这里需要实现删除任务相关文件的逻辑
            log.debug("删除任务文件 - taskId: {}", taskId);
        }
        catch (Exception e) {
            log.error("删除任务文件失败 - taskId: {}, error: {}", taskId, e.getMessage(), e);
        }
    }

    /**
     * 删除任务接收对象
     */
    private void deleteTaskReceivers(Long taskId) {
        try {
            // 调用Mapper删除任务接收对象
            int result = menTaskRecObjMapper.deleteByTaskId(taskId);
            if (result > 0) {
                log.debug("删除任务接收对象成功 - taskId: {}, 删除数量: {}", taskId, result);
            }
            else {
                log.debug("没有找到任务接收对象 - taskId: {}", taskId);
            }
        }
        catch (Exception e) {
            log.error("删除任务接收对象失败 - taskId: {}, error: {}", taskId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.task.receiver.delete.failed", e.getMessage()));
        }
    }

    /**
     * 删除任务目录
     */
    private void deleteTaskCatalogs(Long taskId) {
        try {

            LambdaQueryWrapper<MenTaskCatalog> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.eq(MenTaskCatalog::getTaskId, taskId);
            int result = menTaskCatalogMapper.delete(queryWrapper);
            if (result > 0) {
                log.debug("删除任务目录成功 - taskId: {}, 删除数量: {}", taskId, result);
            }
            else {
                log.debug("没有找到任务目录 - taskId: {}", taskId);
            }
        }
        catch (Exception e) {
            log.error("删除任务目录失败 - taskId: {}, error: {}", taskId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.task.catalog.delete.failed", e.getMessage()));
        }
    }

    /**
     * 删除资源组件
     */
    private void deleteResourceComponent(Long resComId) {
        try {
            // 调用Mapper删除资源组件
            int result = menResComMapper.deleteById(resComId);
            if (result > 0) {
                log.debug("删除资源组件成功 - resComId: {}", resComId);
            }
            else {
                log.warn("删除资源组件失败，可能资源组件不存在 - resComId: {}", resComId);
            }
        }
        catch (Exception e) {
            log.error("删除资源组件失败 - resComId: {}, error: {}", resComId, e.getMessage(), e);
            throw new BdpRuntimeException(I18nUtil.get("template.resource.component.delete.failed", e.getMessage()));
        }
    }

    /**
     * 删除任务
     */
    private void deleteTask(Long taskId) {
        try {
            menTaskMapper.deleteById(taskId);
            log.debug("删除任务成功 - taskId: {}", taskId);
        }
        catch (Exception e) {
            log.error("删除任务失败 - taskId: {}, error: {}", taskId, e.getMessage(), e);
        }
    }

    /**
     * 从Response创建MultipartFile
     */
    private MultipartFile createMultipartFileFromResponse(Response downloadResponse, String fileName) {
        return new MultipartFile() {
            @Override
            public String getName() {
                return "file";
            }

            @Override
            public String getOriginalFilename() {
                return fileName;
            }

            @Override
            public String getContentType() {
                // 1. 优先从根据文件扩展名获取MIME类型
                if (StringUtils.isNotBlank(fileName)) {
                    try {
                        // 使用Java标准库的FileNameMap来获取MIME类型
                        FileNameMap fileNameMap = java.net.URLConnection.getFileNameMap();
                        String mimeType = fileNameMap.getContentTypeFor(fileName);
                        if (StringUtils.isNotBlank(mimeType)) {
                            return mimeType;
                        }
                    }
                    catch (Exception e) {
                        log.warn("无法根据文件名获取MIME类型 - fileName: {}, error: {}", fileName, e.getMessage());
                    }
                }

                // 2. 从响应头中获取Content-Type
                Collection<String> contentTypeCollection = downloadResponse.headers().get("Content-Type");
                String contentType = (contentTypeCollection != null && !contentTypeCollection.isEmpty())
                    ? contentTypeCollection.iterator().next()
                    : null;
                if (StringUtils.isNotBlank(contentType)) {
                    return contentType;
                }

                // 3. 最后才使用默认值
                return "application/octet-stream";
            }

            @Override
            public boolean isEmpty() {
                try {
                    return downloadResponse.body() == null || downloadResponse.body().asInputStream().available() == 0;
                }
                catch (Exception e) {
                    return true;
                }
            }

            @Override
            public long getSize() {
                try {
                    return downloadResponse.body() != null ? downloadResponse.body().asInputStream().available() : 0;
                }
                catch (Exception e) {
                    return 0;
                }
            }

            @Override
            public byte[] getBytes() {
                try {
                    return downloadResponse.body() != null ? downloadResponse.body().asInputStream().readAllBytes()
                        : new byte[0];
                }
                catch (Exception e) {
                    log.error("获取文件字节数组失败 - fileName: {}, error: {}", fileName, e.getMessage(), e);
                    return new byte[0];
                }
            }

            @Override
            public InputStream getInputStream() {
                try {
                    return downloadResponse.body() != null ? downloadResponse.body().asInputStream()
                        : new java.io.ByteArrayInputStream(new byte[0]);
                }
                catch (Exception e) {
                    log.error("获取文件输入流失败 - fileName: {}, error: {}", fileName, e.getMessage(), e);
                    return new java.io.ByteArrayInputStream(new byte[0]);
                }
            }

            @Override
            public void transferTo(File dest) throws IOException, IllegalStateException {
                try {
                    byte[] bytes = getBytes();
                    java.nio.file.Files.write(dest.toPath(), bytes);
                }
                catch (Exception e) {
                    throw new IOException(I18nUtil.get("template.session.file.transfer.failed", e.getMessage()), e);
                }
            }
        };
    }

    /**
     * 从KnowledgeResponse中提取新文件ID
     */
    private String extractNewFileIdFromKnowledgeResponse(KnowledgeResponse<Object> response) {
        try {
            if (response != null && response.getResultObject() != null) {
                // 根据实际的响应结构来解析文件ID
                // 这里需要根据知识库服务的实际响应格式来调整
                Object resultObject = response.getResultObject();
                if (resultObject instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> resultMap = (Map<String, Object>) resultObject;
                    Object fileId = resultMap.get("fileId");
                    if (fileId != null) {
                        return fileId.toString();
                    }
                }
            }
            return null;
        }
        catch (Exception e) {
            log.error("提取文件ID失败 - response: {}, error: {}", response, e.getMessage(), e);
            return null;
        }
    }

    /**
     * 从uploadFiles响应中提取新文件ID
     */
    private String extractNewFileIdFromUploadFilesResponse(KnowledgeResponse<Map<String, Object>> response) {
        try {
            if (response != null && response.getResultObject() != null) {
                Map<String, Object> resultObject = response.getResultObject();
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> successFiles = (List<Map<String, Object>>) resultObject.get("successFiles");
                if (successFiles != null && !successFiles.isEmpty()) {
                    // 取第一个成功上传的文件ID
                    Map<String, Object> firstFile = successFiles.get(0);
                    Object fileId = firstFile.get("fileId");
                    if (fileId != null) {
                        return fileId.toString();
                    }
                }
            }
            return null;
        }
        catch (Exception e) {
            log.error("提取文件ID失败 - response: {}, error: {}", response, e.getMessage(), e);
            return null;
        }
    }

    /**
     * 为文件添加文件名标签（FN_标签）
     */
    private void addFileNameTag(String newFileId, String fileName) {
        try {
            if (StringUtils.isBlank(fileName)) {
                return;
            }

            // 构建添加标签的请求
            Map<String, Object> request = new HashMap<>();
            request.put("fileId", newFileId);
            request.put("tags", "FN_" + fileName);

            // 调用知识库服务添加文件标签
            KnowledgeResponse<List<Map<String, Object>>> response = fileService.addFileTagsBatch(request);

            if (response == null || !Constants.RESPONSE_SUCCESS.equals(response.getResultCode())) {
                log.warn("添加文件名标签失败 - newFileId: {}, fileName: {}, response: {}", newFileId, fileName,
                    response != null ? response.getResultMsg() : "null");
            }
            else {
                log.debug("文件名标签添加成功 - newFileId: {}, fileName: {}", newFileId, fileName);
            }

        }
        catch (Exception e) {
            log.error("添加文件名标签失败 - newFileId: {}, fileName: {}, error: {}", newFileId, fileName, e.getMessage(), e);
            // 不抛出异常，因为标签添加失败不应该影响整个流程
        }
    }
}
