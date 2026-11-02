package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardCodec;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardActor;
import com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos;
import com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos.*;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Public routes accept identities/selectors only; successful target reads are independent of source membership. */
@RestController
@RequestMapping("/group-chats")
public class GroupChatForwardController {
    private final GroupChatForwardService forwards;
    private final GroupChatForwardTargetQueryService targets;
    private final GroupChatForwardQueryService queries;
    private final TenantGroupForwardService tenant;
    private final ForwardCodec codec=new ForwardCodec();
    public GroupChatForwardController(GroupChatForwardService forwards,GroupChatForwardTargetQueryService targets,
        GroupChatForwardQueryService queries,TenantGroupForwardService tenant) {
        this.forwards=forwards; this.targets=targets; this.queries=queries; this.tenant=tenant;
    }
    private ForwardActor actor() {
        var user=CurrentUserHolder.getCurrentUserId(); var context=TenantRequestContextHolder.get();
        if(user==null || user<=0 || context!=null && context.userId()!=user)throw new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE");
        Long enterprise=CurrentUserHolder.getEnterpriseId();
        if(context!=null)enterprise=context.enterpriseId();
        if(enterprise==null || enterprise<=0)throw new IllegalArgumentException("FORWARD_TENANT_UNRESOLVED");
        return new ForwardActor(user,enterprise);
    }
    private static void keys(Map<String,String> query,String... keys) {
        if(!Set.of(keys).containsAll(query.keySet()))throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
    }
    private static int number(String raw,int fallback,int maximum) {
        if(raw==null)return fallback;
        try { if(!raw.matches("[1-9][0-9]*"))throw new IllegalArgumentException(); int value=Integer.parseInt(raw);if(value>maximum)throw new IllegalArgumentException();return value; }
        catch(IllegalArgumentException error) { throw new IllegalArgumentException("FORWARD_INVALID_REQUEST"); }
    }
    @GetMapping("/{sourceId}/forward-targets")
    public ResponseUtil<PageInfo<TargetItem>> targets(@PathVariable String sourceId,@RequestParam Map<String,String> query) {
        keys(query,"pageNum","pageSize","keyword");
        int page=number(query.get("pageNum"),1,Integer.MAX_VALUE),size=number(query.get("pageSize"),20,100);
        String keyword=query.get("keyword");if(keyword!=null && keyword.trim().length()>100)throw new IllegalArgumentException("FORWARD_INVALID_REQUEST");
        var actor=actor();long source=ForwardCodec.parseId(sourceId);
        var result=TenantRequestContextHolder.get()==null?targets.listTargets(actor,source,page,size,keyword):tenant.targets(actor,source,page,size,keyword);
        return ResponseUtil.successResponse(result);
    }
    @PostMapping("/{sourceId}/message-forwards")
    public ResponseEntity<ResponseUtil<OperationResponse>> create(@PathVariable String sourceId,@RequestBody String body) {
        var input=codec.readInput(body);
        return ResponseEntity.accepted().body(ResponseUtil.successResponse(ForwardDtos.operation(forwards.create(actor(),ForwardCodec.parseId(sourceId),input))));
    }
    @GetMapping("/{sourceId}/message-forwards/{requestId}")
    public ResponseUtil<OperationResponse> status(@PathVariable String sourceId,@PathVariable String requestId) {
        return ResponseUtil.successResponse(ForwardDtos.operation(forwards.status(actor(),ForwardCodec.parseId(sourceId),ForwardCodec.parseId(requestId))));
    }
    @PostMapping("/{sourceId}/message-forwards/{requestId}/retry")
    public ResponseUtil<OperationResponse> retry(@PathVariable String sourceId,@PathVariable String requestId,@RequestBody String body) {
        var selected=codec.readRetry(body);
        return ResponseUtil.successResponse(ForwardDtos.operation(forwards.retry(actor(),ForwardCodec.parseId(sourceId),ForwardCodec.parseId(requestId),selected)));
    }
    @GetMapping("/{targetId}/messages/{messageId}/forward-items")
    public ResponseUtil<ItemPage> items(@PathVariable String targetId,@PathVariable String messageId,@RequestParam Map<String,String> query) {
        keys(query,"pageSize","cursor");
        return ResponseUtil.successResponse(queries.items(actor(),ForwardCodec.parseId(targetId),ForwardCodec.parseId(messageId),number(query.get("pageSize"),20,100),query.get("cursor")));
    }
    /** Keep forwarding protocol errors scoped to these routes, without reclassifying ordinary application exceptions. */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ResponseUtil<Object>> rejected(IllegalArgumentException error) {
        String code=error.getMessage();
        HttpStatus status="RESOURCE_NOT_ACCESSIBLE".equals(code)?HttpStatus.NOT_FOUND:"FORWARD_INVALID_REQUEST".equals(code)?HttpStatus.BAD_REQUEST:"FORWARD_TENANT_NOT_READY".equals(code)?HttpStatus.SERVICE_UNAVAILABLE:HttpStatus.CONFLICT;
        return ResponseEntity.status(status).body(ResponseUtil.fail(code));
    }
}
