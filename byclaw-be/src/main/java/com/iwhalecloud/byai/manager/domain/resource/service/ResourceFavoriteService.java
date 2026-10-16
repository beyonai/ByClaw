package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceFavoriteQo;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.ResourceFavoriteMapper;
import com.iwhalecloud.byai.manager.vo.auth.ResourceFavoriteVo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class ResourceFavoriteService {
    private static final long SCHEMA_RECHECK_MILLIS = 30_000L;
    private static final Set<String> SUPPORTED_TYPES = Set.of(
        "DIG_EMPLOYEE", "SKILL", "KG_DOC", "KG_QA", "KG_TERM", "MCP", "TOOLKIT", "AGENT");

    private final ResourceFavoriteMapper mapper;
    private final ByaiSystemConfigService systemConfigService;
    private final AuthApplicationService authApplicationService;
    private final ResourceFavoriteLockService favoriteLockService;
    private volatile boolean schemaReady;
    private volatile long schemaRetryAt;

    /** 普通列表不读取配置或收藏表；收藏场景以服务端版本和登录上下文为准。 */
    public Long resolveQueryTenant(Boolean includeFavorites, Boolean favoritesOnly) {
        if (!Boolean.TRUE.equals(includeFavorites) && !Boolean.TRUE.equals(favoritesOnly)) {
            return null;
        }
        if (!isCommercial()) {
            if (Boolean.TRUE.equals(favoritesOnly)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "resource.favorite.commercialOnly");
            }
            return null;
        }
        Long tenantId = requireTenant();
        if (!isSchemaReady()) {
            if (Boolean.TRUE.equals(favoritesOnly)) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "resource.favorite.notReady");
            }
            return null;
        }
        return tenantId;
    }

    @Transactional
    public ResourceFavoriteVo setFavorite(ResourceFavoriteQo qo) {
        if (!isCommercial()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "resource.favorite.commercialOnly");
        }
        Long tenantId = requireTenant();
        if (!isSchemaReady()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "resource.favorite.notReady");
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        // 所有用户对同一企业资源的收藏写入串行执行，锁持续到事务完成。
        favoriteLockService.acquire(tenantId, qo.getResourceId());
        SsResource resource = mapper.selectResource(qo.getResourceId(), tenantId);
        if (resource == null || resource.getResourceBizType() == null || !SUPPORTED_TYPES.contains(resource.getResourceBizType())
            || !"enterprise".equals(resource.getOwnerType())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "resource.favorite.unavailable");
        }
        // Removing an old favorite remains possible after access is revoked.
        boolean controlled = Boolean.TRUE.equals(resource.getViewAuthControlled()) || Boolean.TRUE.equals(resource.getUseAuthControlled());
        if (Boolean.TRUE.equals(qo.getFavorited())) {
            boolean visible = controlled ? authApplicationService.hasResourceViewPermission(resource)
                : !authApplicationService.queryCurrentUserUseBlacklistedResourceIds(
                    List.of(resource.getResourceId()), List.of(resource.getResourceBizType())).contains(resource.getResourceId());
            if (!Integer.valueOf(2).equals(resource.getResourceStatus()) || !visible) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "resource.favorite.unavailable");
            }
        }
        Long count = mapper.selectCount(qo.getResourceId(), tenantId);
        if (count == null) {
            // 历史计数行缺失时按已有收藏关系初始化，取消旧收藏也不会产生负数。
            count = mapper.countFavorites(qo.getResourceId(), tenantId);
            if (mapper.insertCount(qo.getResourceId(), tenantId, count) != 1) {
                throw new IllegalStateException("Resource favorite count initialization failed");
            }
        }
        int changed = 0;
        if (Boolean.TRUE.equals(qo.getFavorited())) {
            if (mapper.countUserFavorite(qo.getResourceId(), tenantId, userId) == 0) {
                changed = mapper.insertFavorite(qo.getResourceId(), tenantId, userId);
            }
        } else {
            changed = mapper.deleteFavorite(qo.getResourceId(), tenantId, userId);
        }
        int delta = changed == 0 ? 0 : Boolean.TRUE.equals(qo.getFavorited()) ? 1 : -1;
        if (delta != 0 && mapper.updateCount(qo.getResourceId(), tenantId, delta) != 1) {
            throw new IllegalStateException("Resource favorite count update failed");
        }
        return new ResourceFavoriteVo(Boolean.TRUE.equals(qo.getFavorited()), count + delta);
    }

    private boolean isCommercial() {
        return "commercial".equalsIgnoreCase(systemConfigService.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION"));
    }

    /** 建表成功后不再探测；未建表时每节点最多每 30 秒检查一次，官方列表回退原查询。 */
    private boolean isSchemaReady() {
        if (schemaReady) return true;
        long now = System.currentTimeMillis();
        if (now < schemaRetryAt) return false;
        synchronized (this) {
            if (schemaReady || now < schemaRetryAt) return schemaReady;
            schemaReady = mapper.isSchemaReady();
            schemaRetryAt = now + SCHEMA_RECHECK_MILLIS;
            return schemaReady;
        }
    }

    private Long requireTenant() {
        Long tenantId = CurrentUserHolder.getEnterpriseId();
        if (tenantId == null || CurrentUserHolder.getCurrentUserId() == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "resource.favorite.loginRequired");
        }
        return tenantId;
    }
}
