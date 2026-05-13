package com.iwhalecloud.byai.state.domain.message.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.manager.dto.message.MessageShareLinkStatusDto;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.manager.entity.message.MessageShareLink;
import com.iwhalecloud.byai.manager.entity.message.MessageShareLinkMessage;
import com.iwhalecloud.byai.manager.mapper.message.MessageShareLinkMapper;
import com.iwhalecloud.byai.manager.mapper.message.MessageShareLinkMessageMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.JwtTokenFilter;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.SessionFilter;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.SsoTokenFilter;
import com.iwhalecloud.byai.state.interfaces.controller.message.dto.MessageShareLinkResponse;
import com.iwhalecloud.byai.state.common.dto.MessageQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 消息分享链接领域服务
 * <p>
 * 职责：
 * </p>
 * <ul>
 * <li>校验消息是否存在且合法</li>
 * <li>生成安全的分享链接标识</li>
 * <li>落库 message_share_link 主表与 message_share_link_message 关联表</li>
 * </ul>
 */
@Service
public class MessageShareService {

    private static final Logger logger = LoggerFactory.getLogger(MessageShareService.class);


    /** 默认访问权限：需要认证 */
    private static final String DEFAULT_ACCESS_PERMISSION = "AUTHENTICATED";

    /** 链接状态：有效 */
    private static final String LINK_STATUS_ACTIVE = "ACTIVE";

    /** 访问权限：公开访问 */
    private static final String ACCESS_PERMISSION_PUBLIC = "PUBLIC";

    /** 访问权限：需要认证 */
    private static final String ACCESS_PERMISSION_AUTHENTICATED = "AUTHENTICATED";

    @Autowired
    private MessageShareLinkMapper messageShareLinkMapper;

    @Autowired
    private MessageShareLinkMessageMapper messageShareLinkMessageMapper;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SessionFilter sessionFilter;

    @Autowired
    private JwtTokenFilter jwtTokenFilter;

    @Autowired
    private SsoTokenFilter ssoTokenFilter;

    @Autowired
    private MessageService messageService;

    /**
     * 为多条消息生成一个分享链接（一个链接对应多条消息，关联表 message_share_link_message 记录关系）
     *
     * @param messageIds 消息ID列表（必填）
     * @param expireDays 有效期天数，可为空
     * @param maxAccessCount 最大访问次数，可为空（空表示无限制）
     * @param accessPermission 访问权限类型：PUBLIC / AUTHENTICATED，默认 AUTHENTICATED
     * @param title 链接标题
     * @return 分享链接唯一标识（token）
     */
    @Transactional(rollbackFor = Exception.class)
    public String createShareLink(List<Long> messageIds, Integer expireDays, Long maxAccessCount,
        String accessPermission, String title) {
        // 输入参数校验（与 DTO @Valid 互补：DTO 已校验非空与标题长度，此处仅校验 DTO 未覆盖的范围与数量上限）
        validateCreateLinkParameters(messageIds, expireDays, maxAccessCount);

        String resolvedPermission = StringUtils.isBlank(accessPermission) ? ACCESS_PERMISSION_AUTHENTICATED
            : accessPermission.toUpperCase();
        if (!ACCESS_PERMISSION_PUBLIC.equals(resolvedPermission)
            && !ACCESS_PERMISSION_AUTHENTICATED.equals(resolvedPermission)) {
            throw new BaseException("assistant.chat.server.error");
        }

        Long linkId = sequenceService.nextSnowId();
        String uuid = UUID.randomUUID().toString();
        String linkToken = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(uuid.getBytes(StandardCharsets.UTF_8));

        LocalDateTime now = LocalDateTime.now();
        LocalDateTime expireTime = null;
        if (expireDays != null && expireDays > 0) {
            expireTime = now.plusDays(expireDays.longValue());
        }

        Long creatorId = CurrentUserHolder.getCurrentUserId();
        Long enterpriseId = CurrentUserHolder.getEnterpriseId();

        MessageShareLink linkRecord = MessageShareLink.builder().linkId(linkId).linkToken(linkToken)
            .creatorId(creatorId).status(LINK_STATUS_ACTIVE).title(title).accessPermission(resolvedPermission)
            .expireTime(expireTime).maxAccessCount(maxAccessCount).currentAccessCount(0L).lastAccessTime(null)
            .createTime(now).updateTime(now).comAcctId(enterpriseId).build();

        int linkRows = messageShareLinkMapper.insert(linkRecord);
        if (linkRows <= 0) {
            throw new BaseException("assistant.chat.server.error");
        }

        // 批量写入关联表：一个链接对应多条消息，提高插入性能
        List<MessageShareLinkMessage> msgRecords = new ArrayList<>();
        for (Long messageId : messageIds) {
            MessageShareLinkMessage msgRecord = MessageShareLinkMessage.builder().id(sequenceService.nextSnowId())
                .linkId(linkId).messageId(messageId).createTime(now).comAcctId(enterpriseId).build();
            msgRecords.add(msgRecord);
        }

        // 使用批量插入优化性能，避免多次数据库交互
        int msgRows = messageShareLinkMessageMapper.insertBatch(msgRecords);
        if (msgRows != messageIds.size()) {
            throw new BaseException("assistant.chat.server.error");
        }

        return linkToken;
    }

    /**
     * 根据分享链接ID查询关联的消息ID列表（供访问链接时拉取消息用）
     *
     * @param linkId 分享链接ID
     * @return 消息ID列表，无则返回空列表
     */
    public List<Long> listMessageIdsByLinkId(Long linkId) {
        if (linkId == null) {
            return Collections.emptyList();
        }
        return messageShareLinkMessageMapper.selectMessageIdsByLinkId(linkId);
    }

    /**
     * 校验分享链接是否可访问，若可访问则更新访问次数并返回关联的消息ID列表
     * <p>
     * 校验规则：链接存在、状态为 ACTIVE、未过期、未超过最大访问次数（若有限制）。 AUTHENTICATED 权限由网关/过滤器在调用前校验登录态。
     * </p>
     *
     * @param linkToken 分享链接唯一标识（URL 中的 token）
     * @param response 当前 HTTP 响应，需登录且未认证时直接设置 status=401 并写入响应体
     * @return 该链接关联的消息列表，若已写入 401 则返回 null
     * @throws BaseException 链接不存在、已失效、已过期或超过访问次数时抛出
     */
    @Transactional(rollbackFor = Exception.class)
    public MessageShareLinkResponse validateAccessAndGetMessageIds(String linkToken, HttpServletResponse response) {
        // 执行完整的链接访问校验流程（含需登录时校验认证，未认证则 response 设 401 并抛异常终止）
        MessageShareLinkStatusDto validatedLink = performLinkValidation(linkToken, response);
        if (!validatedLink.getIsSuccess()) {
            return buildResponse(validatedLink, null);
        }

        // 获取并校验消息ID列表
        List<Long> messageIds = getValidatedMessageIds(validatedLink.getLinkId());

        // 更新访问记录
        LocalDateTime now = LocalDateTime.now();
        updateAccessRecord(validatedLink.getLinkId(), now);

        // 构建并返回响应
        return buildResponse(validatedLink, messageIds);
    }

    /**
     * 校验创建分享链接的输入参数（仅校验 DTO 未覆盖项：消息数量上限、过期天数范围、最大访问次数范围）
     * <p>
     * 消息ID/标题非空及标题长度由 Controller 层 @Valid MessageShareLinkCreateRequest 保证。
     * </p>
     */
    private void validateCreateLinkParameters(List<Long> messageIds, Integer expireDays, Long maxAccessCount) {
        validateMessageIdsCount(messageIds);
        validateExpireDays(expireDays);
        validateMaxAccessCount(maxAccessCount);
    }

    /**
     * 校验消息ID数量上限（防止批量操作风险，DTO 无此注解故在服务端校验）
     * <p>
     * 非空由 DTO @NotEmpty 保证；此处防御直接调用 Service 时 messageIds 为 null 或数量超限。
     * </p>
     */
    private void validateMessageIdsCount(List<Long> messageIds) {
        if (messageIds == null) {
            throw new BaseException("assistant.chat.message.id.not.empty");
        }
        if (messageIds.size() > 100) {
            throw new BaseException("assistant.chat.share.link.message.count.exceed");
        }
    }

    /**
     * 校验过期天数参数
     */
    private void validateExpireDays(Integer expireDays) {
        if (expireDays != null && (expireDays < 1 || expireDays > 365)) {
            throw new BaseException("assistant.chat.share.link.expire.days.invalid");
        }
    }

    /**
     * 校验最大访问次数参数（DTO 无范围注解故在服务端校验）
     */
    private void validateMaxAccessCount(Long maxAccessCount) {
        if (maxAccessCount != null && (maxAccessCount < 1 || maxAccessCount > 10000)) {
            throw new BaseException("assistant.chat.share.link.max.access.invalid");
        }
    }

    /**
     * 执行完整的链接访问校验流程
     * <p>
     * 包括：token校验、状态校验、权限校验、过期校验、访问次数校验
     * </p>
     *
     * @param linkToken 分享链接token
     * @param response 当前 HTTP 响应，需登录且未认证时用于写入 401
     * @return 校验通过的链接实体
     */
    private MessageShareLinkStatusDto performLinkValidation(String linkToken, HttpServletResponse response) {
        // 1. 校验token并获取链接信息
        MessageShareLink link = validateLinkToken(linkToken);
        MessageShareLinkStatusDto messageShareLinkStatusDto = new MessageShareLinkStatusDto();
        BeanUtils.copyProperties(link, messageShareLinkStatusDto);

        // 2. 校验链接状态
        validateLinkStatus(link);

        // 3. 校验访问权限（需登录时未认证则直接 response 设 401 并抛异常）
        validateAccessPermission(messageShareLinkStatusDto, response);

        // 4. 校验过期时间
        validateExpiration(link);

        // 5. 校验访问次数
        validateAccessCount(link);

        return messageShareLinkStatusDto;
    }

    /**
     * 获取并校验链接关联的消息ID列表
     *
     * @param linkId 链接ID
     * @return 消息ID列表
     */
    private List<Long> getValidatedMessageIds(Long linkId) {
        List<Long> messageIds = messageShareLinkMessageMapper.selectMessageIdsByLinkId(linkId);
        if (CollectionUtils.isEmpty(messageIds)) {
            throw new BaseException("assistant.chat.server.error");
        }
        return messageIds;
    }

    /**
     * 校验分享链接token并返回链接信息
     */
    private MessageShareLink validateLinkToken(String linkToken) {
        if (StringUtils.isBlank(linkToken)) {
            throw new BaseException("assistant.chat.share.link.token.empty");
        }
        MessageShareLink link = messageShareLinkMapper.selectByLinkToken(linkToken.trim());
        if (link == null) {
            throw new BaseException("assistant.chat.share.link.not.found");
        }
        return link;
    }

    /**
     * 校验分享链接状态
     */
    private void validateLinkStatus(MessageShareLink link) {
        if (!LINK_STATUS_ACTIVE.equals(link.getStatus())) {
            throw new BaseException("assistant.chat.share.link.invalid");
        }
    }

    /**
     * 校验访问权限：当链接为需登录访问时，校验当前请求是否携带认证信息（与 AccessTokenVerifyInterceptor 一致）
     * <p>
     * 若未认证则直接设置 response status=401 并写入响应体，然后抛出运行时异常终止流程。
     * </p>
     */
    private void validateAccessPermission(MessageShareLinkStatusDto link, HttpServletResponse response) {
        if (!ACCESS_PERMISSION_AUTHENTICATED.equals(link.getAccessPermission())) {
            return;
        }
        requireAuthenticatedRequest(link, response);
    }

    /**
     * 校验当前请求已认证：与 AccessTokenVerifyInterceptor 一致，依次尝试 sessionFilter、jwtTokenFilter、ssoTokenFilter 做真实校验。
     * <p>
     * 任一 filter 校验通过则返回；若均未携带凭证或某 filter 校验失败（如 token 过期），则 response 写入 401 并抛出 RuntimeException 终止流程。
     * </p>
     *
     * @param response 当前 HTTP 响应，未认证或校验失败时用于写入 401
     */
    private void requireAuthenticatedRequest(MessageShareLinkStatusDto link, HttpServletResponse response) {
        HttpServletRequest request = getCurrentRequest();
        if (request == null) {
            writeUnauthorizedResponse(response, link);
            return;
        }
        if (trySessionAuth(request, response, link) || tryJwtAuth(request, response, link)
            || trySsoAuth(request, response, link)) {
            return;
        }
        writeUnauthorizedResponse(response, link);
    }

    /** 优先走 session 共享，与拦截器顺序一致。校验通过返回 true，未携带或失败返回 false，异常时写 401 并抛出。 */
    private boolean trySessionAuth(HttpServletRequest request, HttpServletResponse response,
        MessageShareLinkStatusDto link) {
        String userCode = getSessionString(request.getSession(), "USER_CODE");
        if (StringUtils.isEmpty(userCode)) {
            return false;
        }
        try {
            return sessionFilter.doFilter(request.getSession());
        }
        catch (Exception e) {
            logger.error("requireAuthenticatedRequest sessionFilter error, err={}", e.getMessage(), e);
            writeUnauthorizedResponse(response, link);
        }
        return false;
    }

    /** token 认证（beyond-token）。校验通过返回 true，未携带或失败返回 false，异常时写 401 并抛出。 */
    private boolean tryJwtAuth(HttpServletRequest request, HttpServletResponse response,
        MessageShareLinkStatusDto link) {
        String beyondToken = request.getHeader("beyond-token");
        if (StringUtils.isEmpty(beyondToken)) {
            return false;
        }
        try {
            return jwtTokenFilter.doFilter(request.getHeader("system-code"), beyondToken);
        }
        catch (Exception e) {
            logger.error("requireAuthenticatedRequest jwtTokenFilter error, err={}", e.getMessage(), e);
            writeUnauthorizedResponse(response, link);
        }
        return false;
    }

    /** 单点登录 token 认证。校验通过返回 true，未携带或失败返回 false，异常时写 401 并抛出。 */
    private boolean trySsoAuth(HttpServletRequest request, HttpServletResponse response,
        MessageShareLinkStatusDto link) {
        String ssoToken = request.getHeader("SSO-TOKEN");
        if (StringUtils.isEmpty(ssoToken)) {
            return false;
        }
        try {
            return ssoTokenFilter.doFilter(ssoToken);
        }
        catch (Exception e) {
            logger.error("requireAuthenticatedRequest ssoTokenFilter error, err={}", e.getMessage(), e);
            writeUnauthorizedResponse(response, link);
        }
        return false;
    }

    /**
     * 从 session 中获取属性，与 AccessTokenVerifyInterceptor.getSessionString 一致
     */
    private String getSessionString(HttpSession httpSession, String attributeName) {
        if (httpSession == null) {
            return null;
        }
        Object attributeValue = httpSession.getAttribute(attributeName);
        return attributeValue != null ? attributeValue.toString() : null;
    }

    /**
     * 写入 401 未认证响应体，与 AccessTokenVerifyInterceptor 的 setLoginError 格式一致
     *
     * @param response 响应
     */
    private void writeUnauthorizedResponse(HttpServletResponse response, MessageShareLinkStatusDto linkStatusDto) {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setCharacterEncoding("utf-8");
        response.setContentType("application/json; charset=utf-8");
        linkStatusDto.setIsSuccess(false);
    }

    /**
     * 从当前请求上下文获取 HttpServletRequest（用于非拦截器路径下的认证校验）
     */
    private HttpServletRequest getCurrentRequest() {
        try {
            ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            return attrs != null ? attrs.getRequest() : null;
        }
        catch (IllegalStateException e) {
            return null;
        }
    }

    /**
     * 校验过期时间
     */
    private void validateExpiration(MessageShareLink link) {
        LocalDateTime now = LocalDateTime.now();
        if (link.getExpireTime() != null && !link.getExpireTime().isAfter(now)) {
            throw new BaseException("assistant.chat.share.link.expired");
        }
    }

    /**
     * 校验访问次数
     */
    private void validateAccessCount(MessageShareLink link) {
        if (link.getMaxAccessCount() != null && link.getMaxAccessCount() > 0 && link.getCurrentAccessCount() != null
            && link.getCurrentAccessCount() >= link.getMaxAccessCount()) {
            throw new BaseException("assistant.chat.share.link.max.access");
        }
    }

    /**
     * 更新访问记录
     */
    private void updateAccessRecord(Long linkId, LocalDateTime accessTime) {
        messageShareLinkMapper.incrementAccessCountAndUpdateTime(linkId, accessTime);
    }

    /**
     * 构建响应对象
     */
    private MessageShareLinkResponse buildResponse(MessageShareLink link, List<Long> messageIds) {
        MessageShareLinkResponse response = new MessageShareLinkResponse();
        response.setTitle(link.getTitle());
        response.setCreatedTime(link.getCreateTime());
        if (CollectionUtils.isEmpty(messageIds)) {
            response.setMessages(null);
            return response;
        }
        MessageQo messageQo = new MessageQo();
        messageQo.setMessageIds(messageIds);
        List<ByaiMessageHotDto> messages = new ArrayList<>();
        try {
            List<ByaiMessageHotDto> resMes = messageService.getMessageByIds(messageQo);
            messages.addAll(resMes);
        }
        catch (Exception e) {
            throw new BaseException("memory error", e);
        }
        response.setMessages(messages);
        return response;
    }

}
