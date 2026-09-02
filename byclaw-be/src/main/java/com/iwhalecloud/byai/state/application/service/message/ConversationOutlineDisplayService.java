package com.iwhalecloud.byai.state.application.service.message;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.message.entity.ConversationOutlineItem;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.chat.model.MessageResourceDto;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Resolves protocol resource placeholders for conversation navigator summaries.
 *
 * @author qin.guoquan
 * @date 2026-08-31 11:00:38
 * */
@Service
@Slf4j
public class ConversationOutlineDisplayService {

    private static final String DIGITAL_EMPLOYEE_PREFIX = "DIG_EMPLOYEE_";

    private static final String DIGITAL_EMPLOYEE_FALLBACK_NAME = "数字员工";

    private static final Pattern DIGITAL_EMPLOYEE_PLACEHOLDER = Pattern.compile(
        "\\{\\{(DIG_EMPLOYEE_([^}#]+))(?:#([^}]+))?}}"
    );

    @Autowired
    private SsResourceService ssResourceService;

    /**
     * Adds display-safe message content while retaining the original protocol content.
     *
     * @param items conversation outline items
     * @return the enriched items
     */
    public List<ConversationOutlineItem> enrich(List<ConversationOutlineItem> items) {
        if (CollectionUtils.isEmpty(items)) {
            return items == null ? Collections.emptyList() : items;
        }

        Map<String, String> resourceNames = collectRelatedResourceNames(items);
        Set<Long> missingResourceIds = collectMissingDigitalEmployeeIds(items, resourceNames);
        if (!missingResourceIds.isEmpty()) {
            addStoredDigitalEmployeeNames(resourceNames, ssResourceService.findByIdList(missingResourceIds));
        }

        for (ConversationOutlineItem item : items) {
            item.setDisplayContent(resolvePlaceholders(item.getContent(), resourceNames));
        }
        return items;
    }

    private Map<String, String> collectRelatedResourceNames(List<ConversationOutlineItem> items) {
        Map<String, String> resourceNames = new HashMap<>();
        for (ConversationOutlineItem item : items) {
            if (StringUtils.isBlank(item.getRelatedResources())) {
                continue;
            }
            try {
                MessageResourceDto resources = JSON.parseObject(item.getRelatedResources(), MessageResourceDto.class);
                if (resources == null || CollectionUtils.isEmpty(resources.getResourceList())) {
                    continue;
                }
                for (ResourceVo resource : resources.getResourceList()) {
                    addRelatedResourceName(resourceNames, resource);
                }
            }
            catch (Exception exception) {
                log.debug("Failed to parse related resources for conversation outline message {}", item.getMessageId(),
                    exception);
            }
        }
        return resourceNames;
    }

    private void addRelatedResourceName(Map<String, String> resourceNames, ResourceVo resource) {
        if (resource == null || StringUtils.isBlank(resource.getResourceName())) {
            return;
        }
        String resourceName = resource.getResourceName().trim();
        putResourceName(resourceNames, resource.getId(), resourceName);
        putResourceName(resourceNames, resource.getResourceId(), resourceName);
        if (resource.getResourceType() != null && StringUtils.isNotBlank(resource.getResourceId())) {
            putResourceName(resourceNames,
                resource.getResourceType().getCode() + "_" + resource.getResourceId().trim(), resourceName);
        }
    }

    private Set<Long> collectMissingDigitalEmployeeIds(List<ConversationOutlineItem> items,
        Map<String, String> resourceNames) {
        Set<Long> resourceIds = new HashSet<>();
        for (ConversationOutlineItem item : items) {
            Matcher matcher = DIGITAL_EMPLOYEE_PLACEHOLDER.matcher(StringUtils.defaultString(item.getContent()));
            while (matcher.find()) {
                String resourceKey = matcher.group(1);
                String resourceId = matcher.group(2);
                if (resourceNames.containsKey(resourceKey) || resourceNames.containsKey(resourceId)) {
                    continue;
                }
                try {
                    resourceIds.add(Long.valueOf(resourceId));
                }
                catch (NumberFormatException ignored) {
                    // Non-numeric legacy identifiers can only be resolved from related_resources.
                }
            }
        }
        return resourceIds;
    }

    private void addStoredDigitalEmployeeNames(Map<String, String> resourceNames, List<SsResource> resources) {
        if (CollectionUtils.isEmpty(resources)) {
            return;
        }
        for (SsResource resource : resources) {
            if (resource == null || resource.getResourceId() == null
                || !"DIG_EMPLOYEE".equals(resource.getResourceBizType())
                || StringUtils.isBlank(resource.getResourceName())) {
                continue;
            }
            String resourceId = String.valueOf(resource.getResourceId());
            String resourceName = resource.getResourceName().trim();
            putResourceName(resourceNames, resourceId, resourceName);
            putResourceName(resourceNames, DIGITAL_EMPLOYEE_PREFIX + resourceId, resourceName);
        }
    }

    private String resolvePlaceholders(String content, Map<String, String> resourceNames) {
        if (StringUtils.isEmpty(content) || !content.contains("{{" + DIGITAL_EMPLOYEE_PREFIX)) {
            return content;
        }
        Matcher matcher = DIGITAL_EMPLOYEE_PLACEHOLDER.matcher(content);
        StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            String employeeName = firstNonBlank(resourceNames.get(matcher.group(1)),
                resourceNames.get(matcher.group(2)), DIGITAL_EMPLOYEE_FALLBACK_NAME);
            String skillName = resourceNames.get(matcher.group(3));
            String replacement = StringUtils.isBlank(skillName)
                ? "@" + employeeName + " "
                : "#" + employeeName + "#" + skillName;
            matcher.appendReplacement(result, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(result);
        return result.toString();
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (StringUtils.isNotBlank(value)) {
                return value;
            }
        }
        return DIGITAL_EMPLOYEE_FALLBACK_NAME;
    }

    private void putResourceName(Map<String, String> resourceNames, String key, String name) {
        if (StringUtils.isNotBlank(key)) {
            resourceNames.putIfAbsent(key.trim(), name);
        }
    }
}
