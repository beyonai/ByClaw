package com.iwhalecloud.byai.manager.domain.tenant.aspect;

import com.iwhalecloud.byai.manager.domain.tenant.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskDeliveryService;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Routes private task reads to the database that owns the group task. */
@Aspect
@Component
public class TenantGroupTaskRoutingAspect {
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupTaskService tenantTasks;
    @org.springframework.beans.factory.annotation.Autowired
    private TenantGroupPublicationService publications;
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.state.domain.chat.service.TenantScopedSessionEventService projections;
    @org.springframework.beans.factory.annotation.Autowired
    private TenantContextService contexts;
    private final TenantNodeClient node;
    private final ByaiGroupChatTaskMapper legacyTasks;
    private final ByaiGroupChatMentionMapper legacyMembership;
    private final GroupChatTaskDeliveryService delivery;

    public TenantGroupTaskRoutingAspect(TenantNodeClient node, ByaiGroupChatTaskMapper legacyTasks,
        ByaiGroupChatMentionMapper legacyMembership, GroupChatTaskDeliveryService delivery) {
        this.node = node;
        this.legacyTasks = legacyTasks;
        this.legacyMembership = legacyMembership;
        this.delivery = delivery;
    }

    @Around("execution(* com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatTaskController.*(..))")
    /**
     * 群组任务切面：根据任务所属租户把准备、完成、取消、查询和投递状态操作转发到 Node。
     * 每个 case 对应 GroupChatTaskController 的一个方法名，而不是随机字符串。
     */
    public Object route(ProceedingJoinPoint call) throws Throwable {
        TenantRequestContext context = TenantRequestContextHolder.get();
        // 没有请求上下文时，先尝试从已登记任务恢复并校验当前用户身份。
        Object[] args = call.getArgs();
        if (context == null && args.length > 0 && args[0] instanceof Long registeredTask
            && registeredTask >= 8_000_000_000_000_000_000L && projections != null) {
            var registered = projections.registeredOwner(registeredTask);
            if (registered != null) {
                var user = com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getLoginInfo();
                if (user == null || !Long.valueOf(registered.userId()).equals(user.getUserId())) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "tenant.task.owner.required");
                }
                context = contexts.validate(Long.toString(registered.enterpriseId()));
            }
        }
        // 无法恢复租户上下文时继续公共库旧逻辑，由原 Controller 自己处理。
        if (context == null) return call.proceed();
        if (args.length == 0 || !(args[0] instanceof Long taskId) || taskId <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenant.group.task.invalid");
        }
        String method = ((MethodSignature) call.getSignature()).getMethod().getName();
        String path = "/internal/v1/group-chat/tasks/" + taskId;
        return switch (method) {
            // prepare 创建或登记待发布任务，实际任务状态由租户任务服务维护。
            case "prepare" -> ResponseUtil.successResponse(tenantTasks.prepare(context, taskId,
                (com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatPendingPublicationRequest) args[1]));
            // complete 确认任务执行结果并发布任务产生的内容。
            case "complete" -> ResponseUtil.successResponse(publications.complete(context, taskId,
                (com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskCompleteRequest) args[1]));
            // cancel 撤销任务，不需要再向 Node 返回任务详情。
            case "cancel" -> { tenantTasks.cancel(context, taskId); yield ResponseUtil.successResponse(null); }
            // detail 查询单个任务详情。
            case "detail" -> ResponseUtil.successResponse(node.request(context, "GET", path, null,
                new TypeReference<Object>() { }));
            // pending 查询等待发布的任务。
            case "pending" -> ResponseUtil.successResponse(node.request(context, "GET",
                path + "/pending-publication", null, new TypeReference<Object>() { }));
            case "deliveryStatus" -> {
                // deliveryStatus 先让 Node 校验群成员和任务发起人，再读取本地投递状态。
                node.request(context, "GET", path, null, new TypeReference<Object>() { });
                yield ResponseUtil.successResponse(delivery.currentAuthorized(taskId));
            }
            default -> throw new ResponseStatusException(HttpStatus.CONFLICT,
                "i18n.status.tenant.group.task.operation.is.not.ready");
        };
    }
}
