package com.iwhalecloud.byai.manager.domain.tenant.aspect;

import com.iwhalecloud.byai.manager.domain.tenant.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageId;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.common.util.RuntimeEnvironment;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatFileController;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatMemberRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatSettingsRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatReadStateRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * 群组接口的统一租户路由器。
 *
 * <p>这个类本身不保存群组数据，只负责三件事：识别当前 Controller 方法、判断当前租户类型、
 * 决定调用公共库还是租户 Node。标准租户的数据走 Node，个人空间和试用租户沿用公共库逻辑。</p>
 */
@Aspect
@Component
public class TenantGroupChatRoutingAspect {
    private final TenantModeService tenantModes;
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupMessageDisplayService messageDisplayService;
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupMessageAckService messageAckService;
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupManagementService management;
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupInvitationService invitations;
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupCreationService creation;
    private final TenantNodeClient node;
    private final GroupChatReadService legacy;
    private final ByaiGroupChatMentionMapper mentionMapper;
    private final ObjectMapper mapper;
    private final TenantGroupMemberService memberService;

    public TenantGroupChatRoutingAspect(TenantNodeClient node, GroupChatReadService legacy,
        ByaiGroupChatMentionMapper mentionMapper, ObjectMapper mapper, TenantGroupMemberService memberService,
        TenantModeService tenantModes) {
        this.node = node;
        this.legacy = legacy;
        this.mentionMapper = mentionMapper;
        this.mapper = mapper;
        this.memberService = memberService;
        this.tenantModes = tenantModes;
    }

    @Around("execution(* com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatController.*(..))"
        + " || execution(* com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatTopicController.*(..))"
        + " || execution(* com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatFileController.*(..))"
        + " || execution(* com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatForwardController.*(..))")
    /**
     * 统一路由群组 Controller：标准租户调用 Node，试用租户和个人空间执行公共库逻辑。
     * 分支依据 Controller 类型、方法名和当前租户模式决定，实际数据操作交给对应应用服务。
     */
    public Object route(ProceedingJoinPoint call) throws Throwable {
        // Forwarding owns its typed, strict routing boundary; generic create/list branches have legacy development exceptions.
        // 转发 Controller 有独立的严格路由边界，避免被通用群组路由重复处理。
        if (call.getTarget() instanceof com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatForwardController) return call.proceed();
        TenantRequestContext context = TenantRequestContextHolder.get();
        String method = ((MethodSignature) call.getSignature()).getMethod().getName();
        Object[] args = call.getArgs();
        // 跨企业聚合接口自己解析全部成员关系并逐租户查询，不能被当前租户路由器截断。
        if ("aggregated".equals(method)) return call.proceed();
        // 邀请接口先从 token 解析租户；试用租户没有 Node，直接使用公共库实现。
        if (List.of("createInvitation", "validateInvitation", "joinInvitation").contains(method)) {
            context = invitations.resolve(method, args, context);
            if (context == null) return call.proceed();
            // 试用租户没有独立 Node；链接解析出试用租户后也沿用共享库公共实现。
            if (tenantModes.isSharedDataTenant(context.enterpriseId())) return call.proceed();
            return ResponseUtil.successResponse(invitations.handle(context, method, args));
        }
        // 无租户上下文表示个人空间；试用租户也没有独立 Node，这两类都保留原始调用。
        if (context == null || tenantModes.isSharedDataTenant(context.enterpriseId())) return call.proceed();
        if ("defaultAssistant".equals(method)) return call.proceed();
        // 标准租户创建工作组由 TenantGroupCreationService 编排，并最终调用 Node 写租户库。
        if ("create".equals(method)) return create(call, context, (GroupChatCreateRequest) args[0]);
        if (args.length == 0 && !"list".equals(method)) throw unsupported();
        String sessionId = args.length > 0 && args[0] instanceof Long id && id > 0 ? id.toString() : null;
        String path = sessionId == null ? null : "/internal/v1/group-chats/" + sessionId;
        // 文件列表与群列表都使用 list 方法，按控制器区分并保持租户数据归属。
        if (call.getTarget() instanceof GroupChatFileController) {
            return read(context, filePath(requirePath(path), args[1], args[2]));
        }
        // 新增确认接口始终按租户上下文落 Node，不回退到共享消息表。
        if ("acknowledge".equals(method) || "unacknowledge".equals(method)) {
            return ResponseUtil.successResponse(messageAckService.change(context,
                Long.valueOf(id(args[0])), Long.valueOf(id(args[1])), "acknowledge".equals(method)));
        }
        if (List.of("nickname", "changeRole", "transferOwnership", "leave", "dissolve",
            "acknowledgeDissolution", "recall", "undoRecall", "directSession").contains(method))
            return ResponseUtil.successResponse(management.change(context, method, Long.valueOf(id(args[0])), args));
        switch (method) {
            case "list": {
                // list 有两种调用形态：分页查群组，或按群组 ID 查话题列表。
                if (args.length == 3 && args[0] instanceof Integer pageNum && args[1] instanceof Integer pageSize) {
                    if (pageNum < 1 || pageSize < 1 || pageSize > 100) throw unsupported();
                    if (args[2] != null && (!(args[2] instanceof Long enterpriseId)
                        || enterpriseId != 1L && !enterpriseId.equals(context.enterpriseId()))) throw unsupported();
                    return ResponseUtil.successResponse(list(context, pageNum, pageSize));
                }
                if (path != null && args.length == 3) {
                    return read(context, topicPath(path + "/topics", args[1], args[2]));
                }
                throw unsupported();
            }
            case "detail":
                // detail 读取指定群组详情，群组 ID 同时决定 Node 内的资源路径。
                return read(context, requirePath(path));
            case "invite":
                // invite 由成员服务处理，服务内部还会做成员资格和席位限额校验。
                return ResponseUtil.successResponse(memberService.invite(context,
                Long.valueOf(sessionId), (GroupChatMemberRequest) args[1]));
            case "remove": {
                // remove 只允许 USER/AGENT 两种成员类型，其他类型避免误删。
                if (path == null || args.length != 3 || !(args[1] instanceof String type)
                    || !(args[2] instanceof Long memberId) || memberId <= 0
                    || !("USER".equals(type) || "AGENT".equals(type))) throw unsupported();
                return ResponseUtil.successResponse(management.change(context, "remove", Long.valueOf(sessionId), args));
            }
            case "settings":
                // settings 读取群组配置，不在本地公共库拼装。
                return read(context, requirePath(path) + "/settings");
            case "updateSettings": {
                // 更新设置前要求请求体至少包含一个可修改字段。
                GroupChatSettingsRequest request = (GroupChatSettingsRequest) args[1];
                if (request == null || request.getSessionName() == null
                    && request.getAllowJoinByLink() == null && request.getAllowMemberAddAgent() == null
                    && request.getAllowMemberInviteUser() == null) throw unsupported();
                node.command(context, "PATCH", requirePath(path) + "/settings", sessionId,
                    "UPDATE_SETTINGS", new TenantNodeModels.GroupSettings(request.getSessionName(),
                        request.getAllowJoinByLink(), request.getAllowMemberAddAgent(),
                        request.getAllowMemberInviteUser()));
                Map<String, Object> detail = node.request(context, "GET", path, null,
                    new TypeReference<Map<String, Object>>() { });
                return ResponseUtil.successResponse(detail.get("session"));
            }
            case "lifecycle":
                // lifecycle 返回群组生命周期状态。
                return read(context, requirePath(path) + "/lifecycle");
            case "tasks":
                // tasks 返回该群组关联的任务列表。
                return read(context, requirePath(path) + "/tasks");
            case "context": {
                // context 按消息边界和字符数读取群聊上下文，参数为空表示请求不合法。
                GroupChatContextRequest request = (GroupChatContextRequest) args[1];
                if (request == null) throw unsupported();
                Map<String, Object> body = new HashMap<>();
                if (request.getBeforeMessageId() != null) {
                    body.put("beforeMessageId", request.getBeforeMessageId());
                }
                if (request.getMaxMessages() != null) body.put("maxMessages", request.getMaxMessages());
                if (request.getMaxCharacters() != null) body.put("maxCharacters", request.getMaxCharacters());
                return write(context, requirePath(path) + "/context", body);
            }
            case "searchMessages": {
                // searchMessages 将搜索条件转为 Node 的查询参数，并丢弃空字段。
                if (args[1] == null) throw unsupported();
                Map<String, Object> body = mapper.convertValue(args[1],
                    new TypeReference<Map<String, Object>>() { });
                body.values().removeIf(java.util.Objects::isNull);
                return write(context, requirePath(path) + "/messages/search", body);
            }
            case "messageContext":
                // messageContext 读取单条消息上下文。
                return read(context, requirePath(path) + "/messages/" + id(args[1]) + "/context");
            case "messages":
                // messages 读取指定话题下的消息，并使用游标分页。
                return read(context, topicPath(requirePath(path) + "/topics/" + id(args[1])
                + "/messages", args[2], args[3]));
            case "claimWelcome": {
                // claimWelcome 领取群组欢迎状态，写入租户 Node 的成员状态。
                // 欢迎状态属于租户内的成员关系；不得回退到共享库或借用已读游标。
                var result = node.command(context, "POST", requirePath(path) + "/welcome", sessionId,
                    "CLAIM_WELCOME", new TenantNodeModels.EmptyPayload());
                if (result == null || result.data() == null) throw unsupported();
                return ResponseUtil.successResponse(result.data());
            }
            case "markRead": {
                // markRead 更新当前用户的已读游标，游标必须是正数消息 ID。
                GroupChatReadStateRequest request = (GroupChatReadStateRequest) args[1];
                if (request == null || request.getLastReadMessageId() == null || request.getLastReadMessageId() <= 0) {
                    throw unsupported();
                }
                node.command(context, "PATCH", requirePath(path) + "/read-state", sessionId,
                    "READ_STATE", new MessageId(request.getLastReadMessageId().toString()));
                return ResponseUtil.successResponse(java.util.Map.of(
                    "sessionId", sessionId,
                    "lastReadMessageId", request.getLastReadMessageId().toString(),
                    "unreadCount", 0,
                    "unreadMentionCount", 0,
                    "hasUnreadMention", false));
            }
            default: throw unsupported();
        }
    }

    /** 创建标准租户工作组：先执行平台侧准备，再调用 Node 完成租户库写入。 */
    private Object create(ProceedingJoinPoint call, TenantRequestContext context, GroupChatCreateRequest request)
        throws Throwable {
        if (RuntimeEnvironment.isDevelopment()) return call.proceed();
        return ResponseUtil.successResponse(creation.create(context, request));
    }

    /** 查询工作组列表；线上标准租户从 Node 读取，开发环境保留公共库兼容路径。 */
    private Object list(TenantRequestContext context, int pageNum, int pageSize) {
        if (RuntimeEnvironment.isDevelopment()) {
            return legacy.listMyGroups(pageNum, pageSize);
        }
        return node.request(context, "GET", "/internal/v1/group-chats?pageNum=" + pageNum + "&pageSize=" + pageSize,
            null, new TypeReference<Map<String, Object>>() {});
    }

    /** 读取租户 Node 资源，并统一处理消息展示投影。 */
    private Object read(TenantRequestContext context, String path) {
        Object response = node.request(context, "GET", path, null, new TypeReference<Object>() { });
        return ResponseUtil.successResponse(messageDisplayService == null ? response : messageDisplayService.resolve(response));
    }

    /** 向租户 Node 写入群组资源。 */
    private Object write(TenantRequestContext context, String path, Object body) {
        Object response = node.request(context, "POST", path, body, new TypeReference<Object>() { });
        return ResponseUtil.successResponse(messageDisplayService == null ? response : messageDisplayService.resolve(response));
    }

    /** 要求路由路径已经成功解析。 */
    private String requirePath(String path) {
        if (path == null) throw unsupported();
        return path;
    }

    /** 将切点参数转换为合法的正数 ID。 */
    private String id(Object value) {
        if (!(value instanceof Long id) || id <= 0) throw unsupported();
        return id.toString();
    }

    /** 构造文件分页路径并校验分页参数。 */
    private String filePath(String path, Object requestedSize, Object cursor) {
        int pageSize = requestedSize == null ? 20 : requestedSize instanceof Integer size ? size : 0;
        if (pageSize < 1 || pageSize > 50) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "groupchat.files.page.size.invalid");
        }
        StringBuilder result = new StringBuilder(path).append("/files?pageSize=").append(pageSize);
        if (cursor != null && !cursor.toString().isBlank()) {
            if (!(cursor instanceof String value) || value.length() > 256 || !value.matches("[A-Za-z0-9_-]+={0,2}")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "groupchat.files.cursor.invalid");
            }
            result.append("&cursor=").append(value);
        }
        return result.toString();
    }

    /** 构造话题消息分页路径并校验游标。 */
    private String topicPath(String path, Object limit, Object cursor) {
        StringBuilder result = new StringBuilder(path).append("?limit=");
        int boundedLimit = limit instanceof Integer count && count > 0 && count <= 100 ? count : 20;
        result.append(boundedLimit);
        if (cursor != null) {
            String value = cursor.toString();
            if (!value.matches("[A-Za-z0-9:_-]{1,128}")) throw unsupported();
            result.append("&cursor=").append(value);
        }
        return result.toString();
    }

    /** 构造统一的租户群组暂不支持错误。 */
    private ResponseStatusException unsupported() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "tenant.group.notReady");
    }
}
