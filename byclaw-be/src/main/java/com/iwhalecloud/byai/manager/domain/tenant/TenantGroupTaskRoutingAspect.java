package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.core.type.TypeReference;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
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
    public Object route(ProceedingJoinPoint call) throws Throwable {
        TenantRequestContext context = TenantRequestContextHolder.get();
        if (context == null) return call.proceed();
        Object[] args = call.getArgs();
        if (args.length == 0 || !(args[0] instanceof Long taskId) || taskId <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid group task");
        }
        ByaiGroupChatTask old = legacyTasks.selectById(taskId);
        if (old != null && legacyMembership.isLegacyGroupMember(old.getGroupSessionId(),
            context.userId(), context.enterpriseId())) return call.proceed();

        String method = ((MethodSignature) call.getSignature()).getMethod().getName();
        String path = "/internal/v1/group-chat/tasks/" + taskId;
        return switch (method) {
            case "detail" -> ResponseUtil.successResponse(node.request(context, "GET", path, null,
                new TypeReference<Object>() { }));
            case "pending" -> ResponseUtil.successResponse(node.request(context, "GET",
                path + "/pending-publication", null, new TypeReference<Object>() { }));
            case "deliveryStatus" -> {
                // The tenant Node enforces both group membership and task initiator before UserFS is read.
                node.request(context, "GET", path, null, new TypeReference<Object>() { });
                yield ResponseUtil.successResponse(delivery.currentAuthorized(taskId));
            }
            default -> throw new ResponseStatusException(HttpStatus.CONFLICT,
                "tenant group task operation is not ready");
        };
    }
}
