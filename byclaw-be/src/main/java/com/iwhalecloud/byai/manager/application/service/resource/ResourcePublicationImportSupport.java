package com.iwhalecloud.byai.manager.application.service.resource;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.dto.resource.ResourcePublishScope;
import com.iwhalecloud.byai.state.domain.resource.dto.ObjectZipImportResult;
import lombok.RequiredArgsConstructor;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/** Separates successful artifact import from publication submission failures. */
@Service @RequiredArgsConstructor
public class ResourcePublicationImportSupport {
    private final ResourcePublicationAccess access;
    private final ResourcePublicationService publications;
    public ResourcePublishScope validate(String ownerType, String value) {
        if (StringUtils.isBlank(value)) return null;
        if (!"enterprise".equals(ownerType)) throw new BaseException("个人资源不设置组织发布范围");
        JSONObject json = JSON.parseObject(value);
        if (json == null || !java.util.Set.of("mode", "orgIds").containsAll(json.keySet())) throw new BaseException("发布范围格式无效");
        ResourcePublishScope scope = new ResourcePublishScope(json.getString("mode"),
            json.getJSONArray("orgIds") == null ? java.util.List.of() : json.getJSONArray("orgIds").toJavaList(Long.class));
        access.normalize(scope); return scope;
    }
    public ObjectZipImportResult finish(ObjectZipImportResult result, ResourcePublishScope scope) {
        if (scope == null || result == null || result.getItems() == null) return result;
        for (var item : result.getItems()) {
            if (!item.isSuccess() || StringUtils.isBlank(item.getResourceId())) continue;
            try {
                publications.submitLocal(Long.valueOf(item.getResourceId()), scope);
                item.setReviewRequired(true);
                item.setMessage("导入成功，组织发布审核中；使用权限保持不变");
            } catch (BaseException exception) {
                item.setPublicationError(exception.getMessage());
                item.setMessage("导入成功，发布尚未提交，请从资源管理继续处理");
            }
        }
        return result;
    }
}
