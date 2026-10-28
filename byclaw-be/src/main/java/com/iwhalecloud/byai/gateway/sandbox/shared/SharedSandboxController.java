package com.iwhalecloud.byai.gateway.sandbox.shared;

import java.util.*;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** 前端只访问 BE；管理权限与租户过滤在转发平台之前确定。 */
@RestController
@RequestMapping("/sandbox/shared")
public class SharedSandboxController {
    private static final Set<String> READ = Set.of("listRecords", "listMembers");
    private static final Set<String> ADMIN = Set.of("listConfigs", "saveConfig", "deleteConfig", "releaseInstance", "releaseMember");
    private final SharedSandboxGateway gateway;

    private final UsersMapper users;

    public SharedSandboxController(SharedSandboxGateway gateway, UsersMapper users) {
        this.gateway = gateway;
        this.users = users;
    }

    @PostMapping("/{operation}")
    public ResponseUtil<?> call(@PathVariable String operation, @RequestBody Map<String, Object> input) {
        if (!READ.contains(operation) && !ADMIN.contains(operation)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        boolean platform = CurrentUserHolder.isPlatformManager();
        if (!platform && (!READ.contains(operation) || !CurrentUserHolder.isBusinessAdmin())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        Map<String, Object> params;
        if ("releaseMember".equals(operation)) {
            if (!(input.get("mappingId") instanceof String mappingId) || mappingId.isBlank() || mappingId.length() > 64) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "mappingId must be a nonblank string of at most 64 characters");
            }
            requirePositiveLong(input.get("generation"));
            // 身份、服务和租户由平台按带代际保护的映射加载，不能采用浏览器提交的用户身份。
            params = new LinkedHashMap<>();
            params.put("mappingId", input.get("mappingId"));
            params.put("generation", input.get("generation"));
            params.put("force", true);
            params.put("reason", "manual");
        }
        else {
            params = new LinkedHashMap<>(input);
        }
        // 不能允许请求体伪造可信权限或用户投影。
        params.remove("userInfo");
        params.remove("platformManager");
        params.remove("operatorUserCode");
        params.remove("tenantScope");
        if (!platform) {
            Long tenant = CurrentUserHolder.getEnterpriseId();
            if (tenant == null || tenant <= 0) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
            params.put("enterpriseId", tenant);
            params.put("tenantScope", tenant);
        }
        params.put("operatorUserCode", CurrentUserHolder.getCurrentUserCode());
        params.put("platformManager", platform);
        if ("listMembers".equals(operation)) prepareMemberFilters(params);
        Object result = gateway.call(operation, params);
        return ResponseUtil.successResponse("listMembers".equals(operation) ? enrichMemberNames(result) : result);
    }


    private void prepareMemberFilters(Map<String, Object> params) {
        params.remove("userCodes");
        params.remove("userIds");
        params.putIfAbsent("status", "ACTIVE");
        String keyword = Objects.toString(params.remove("keyword"), "").trim();
        if (keyword.isEmpty()) return;
        // 目录只解析编码/姓名，平台仍按可信租户范围过滤映射后再分页。
        List<Users> matched = users.selectList(new LambdaQueryWrapper<Users>()
            .select(Users::getUserCode)
            .and(query -> query.like(Users::getUserCode, keyword).or().like(Users::getUserName, keyword)));
        params.put("userCodes", matched.stream().map(Users::getUserCode).filter(Objects::nonNull).distinct().toList());
    }

    @SuppressWarnings("unchecked")
    private Object enrichMemberNames(Object result) {
        if (!(result instanceof Map<?, ?> page) || !(page.get("records") instanceof List<?> records)) return result;
        List<Long> ids = records.stream().filter(Map.class::isInstance).map(Map.class::cast)
            .map(row -> optionalUserId(row.get("userId"))).filter(Objects::nonNull).distinct().toList();
        Map<Long, String> names = new HashMap<>();
        if (!ids.isEmpty()) {
            for (Users user : users.selectBatchIds(ids)) names.put(user.getUserId(), user.getUserName());
        }
        List<Object> enriched = new ArrayList<>();
        for (Object record : records) {
            if (record instanceof Map<?, ?> row) {
                Map<String, Object> copy = new LinkedHashMap<>((Map<String, Object>) row);
                copy.put("userName", names.get(optionalUserId(row.get("userId"))));
                enriched.add(copy);
            }
            else enriched.add(record);
        }
        Map<String, Object> copy = new LinkedHashMap<>((Map<String, Object>) page);
        copy.put("records", enriched);
        return copy;
    }

    private static Long optionalUserId(Object value) {
        if (value == null) return null;
        try {
            return Long.valueOf(value.toString());
        }
        catch (NumberFormatException invalid) {
            return null;
        }
    }

    private static void requirePositiveLong(Object value) {
        Long parsed = optionalUserId(value);
        if (parsed == null || parsed <= 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
            "generation must be a positive integer");
    }
}
