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
        SsResource resource = mapper.selectResource(qo.getResourceId(), tenantId);
        if (resource == null || resource.getResourceBizType() == null || !SUPPORTED_TYPES.contains(resource.getResourceBizType())
            || !"enterprise".equals(resource.getOwnerType())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "resource.favorite.unavailable");
        }
        // 允许取消已下架/注销资源的收藏；新增收藏仍遵守上架和黑名单限制。
        if (Boolean.TRUE.equals(qo.getFavorited())
            && (!Integer.valueOf(2).equals(resource.getResourceStatus())
                || authApplicationService.queryCurrentUserUseBlacklistedResourceIds(
                    List.of(resource.getResourceId()), List.of(resource.getResourceBizType()))
                    .contains(resource.getResourceId()))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "resource.favorite.unavailable");
        }
        mapper.ensureCount(qo.getResourceId(), tenantId);
        // 仅锁定本资源的计数行，防止并发收藏/取消造成计数与关系不一致。
        long count = mapper.lockCount(qo.getResourceId(), tenantId);
        int changed = Boolean.TRUE.equals(qo.getFavorited())
            ? mapper.insertFavorite(qo.getResourceId(), tenantId, userId)
            : mapper.deleteFavorite(qo.getResourceId(), tenantId, userId);
        int delta = changed == 0 ? 0 : Boolean.TRUE.equals(qo.getFavorited()) ? 1 : -1;
        if (delta != 0) {
            mapper.updateCount(qo.getResourceId(), tenantId, delta);
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
