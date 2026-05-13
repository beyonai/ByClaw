package com.iwhalecloud.byai.manager.domain.resource.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDocDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDocMapper;
import com.iwhalecloud.byai.common.util.ListUtil;
import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * @author he.duming
 * @date 2025-10-30 11:12:09
 * @description 文档库扩展服务
 */
@Service
public class SsResExtDocService {

    private static final String KG_DOC_TEMPLATE_PATH = "templates/kg-doc-template.json";

    /** 文档库扩展表 Mapper，负责增删改查 */
    @Autowired
    private SsResExtDocMapper ssResExtDocMapper;

    /** 服务发现中的 Python 构建服务名，写入 targetContent.domainName 供下游路由 */
    @Value("${spring.application.qADomainName:}")
    private String qADomainName;

    @Autowired
    private ResourceRuntimeInfoResolver resourceRuntimeInfoResolver;

    @Autowired
    private ResourceTargetJsonBuilder resourceTargetJsonBuilder;

    private volatile String kgDocTemplateContent;

    /**
     * 插入文档库扩展表
     *
     * @param ssResExtDoc 文档库扩展
     */
    public void save(SsResExtDoc ssResExtDoc) {
        ssResExtDocMapper.insert(ssResExtDoc);
    }

    /**
     * 更新文档库扩展表
     *
     * @param ssResExtDoc 文档库扩展
     */
    public void update(SsResExtDoc ssResExtDoc) {
        ssResExtDocMapper.updateById(ssResExtDoc);
    }

    /**
     * 删除资源
     *
     * @param resourceId 资源标识
     */
    public void removeById(Long resourceId) {
        ssResExtDocMapper.deleteById(resourceId);
    }

    /**
     * 查询资源信息
     *
     * @param resourceId 资源扩展标识
     * @return 扩展记录，不存在时由 Mapper 返回 null
     */
    public SsResExtDoc findById(Long resourceId) {
        return ssResExtDocMapper.selectById(resourceId);
    }

    /**
     * 查询文档库信息
     *
     * @param resourceIds 资源标识
     * @return ResourceExtDocDto
     */
    public List<ResourceExtDocDto> findResourceExtDocByIds(Collection<Long> resourceIds) {
        return ssResExtDocMapper.findResourceExtDocByIds(resourceIds);
    }

    /**
     * 查询单个值
     *
     * @param resourceId 资源标识
     * @return ResourceExtDocDto
     */
    public ResourceExtDocDto findResourceExtDocById(Long resourceId) {
        Set<Long> resourceIds = Collections.singleton(resourceId);
        List<ResourceExtDocDto> resultList = this.findResourceExtDocByIds(resourceIds);
        return ListUtil.isNotEmpty(resultList) ? resultList.get(0) : null;
    }

    /**
     * 创建文档库扩展表
     *
     * @param resourceId 资源标识
     * @param type 类型
     * @return SsResExtDoc
     */
    public SsResExtDoc createSsResExtDoc(Long resourceId, String type) {
        SsResExtDoc ssResExtDoc = new SsResExtDoc();
        ssResExtDoc.setResourceId(resourceId);
        ssResExtDoc.setType(type);
        ssResExtDoc.setTargetContent(buildKgDocTargetContent());
        ssResExtDocMapper.insert(ssResExtDoc);
        return ssResExtDoc;
    }

    /**
     * 按知识库 JSON 模板生成扩展表内容。
     * 当前 createDataset 场景会把 sourceContent/targetContent 都写成同一份最终 JSON，
     * 方便下游直接复用，不再额外区分“原始导入内容”和“最终发布内容”。
     */
    public SsResExtDoc createSsResExtDoc(Long resourceId, String type, String resourceCode, String resourceName,
                                         String resourceDesc, String ownerType) {
        String templateContent = buildDatasetTemplateContent(resourceId, resourceCode, resourceName, resourceDesc,
            ownerType);
        SsResExtDoc ssResExtDoc = new SsResExtDoc();
        ssResExtDoc.setResourceId(resourceId);
        ssResExtDoc.setType(type);
        ssResExtDoc.setSourceContent(templateContent);
        ssResExtDoc.setTargetContent(templateContent);
        ssResExtDocMapper.insert(ssResExtDoc);
        return ssResExtDoc;
    }

    /**
     * add by qin.guoquan at 2026/04/07 保存知识库时，若是百应知识库，且是文档类知识库（KG_DOC），把百应默认知识库的接口返回给嘉朗算法侧（后面）
     *
     * @return targetContent 的 JSON 字符串，含 resourceService 列表
     */
    private String buildKgDocTargetContent() {
        JSONObject targetContent = new JSONObject(true);
        List<JSONObject> resourceService = new ArrayList<>();

        fillKnowledgeRuntimeFields(targetContent);

        resourceService.add(buildKgDocService(qADomainName, "创建知识库", "POST", "/api/v1/knowledge-bases/create",
            "create_kb", "用于创建知识库。"));
        resourceService.add(buildKgDocService(qADomainName, "删除知识库", "POST", "/api/v1/knowledge-bases/delete",
            "delete_kb", "逻辑删除知识库。"));
        resourceService
            .add(buildKgDocService(qADomainName, "写入文件到知识库", "POST", "/api/v1/write-file", "write_raw", "将原始文件写入知识库。"));
        resourceService.add(buildKgDocService(qADomainName, "写入索引到知识库", "POST", "/api/v1/write-index", "write_index",
            "将构建好的索引信息和对应的 markdown 副本写入知识库。"));
        resourceService.add(buildKgDocService(qADomainName, "导入文件与索引", "POST", "/api/v1/knowledge-items/import",
            "import_item", "一次性完成原文件写入、markdown 副本写入与 chunk 索引写入。"));
        resourceService.add(buildKgDocService(qADomainName, "删除知识库文档", "POST", "/api/v1/knowledge-items/delete",
            "delete_item", "逻辑删除知识库中的单个文档。"));
        resourceService.add(buildKgDocService(qADomainName, "检索文档 chunk", "POST", "/api/v1/knowledge-items/search",
            "search_chunk", "用于执行 chunk 级混合检索。"));
        resourceService.add(
            buildKgDocService(qADomainName, "列出知识库目录", "POST", "/api/v1/list_dir", "list_dir", "用于列出知识库中的虚拟目录内容。"));
        resourceService.add(
            buildKgDocService(qADomainName, "正则表达式方式查找文件", "POST", "/api/v1/glob", "glob_search", "基于正则表达式查找文件、目录。"));

        resourceService.add(buildKgDocService(qADomainName, "修改知识库名称、描述、元数据", "POST", "/api/v1/knowledge-bases/update",
            "update_kb", "修改知识库名称、描述、元数据"));
        resourceService.add(buildKgDocService(qADomainName, "按完整路径创建目录", "POST", "/api/v1/directories/create",
            "create_dir", "按完整路径创建目录"));
        resourceService.add(buildKgDocService(qADomainName, "逻辑删除目录，可删除非空目录", "POST", "/api/v1/directories/delete",
            "delete_dir", "逻辑删除目录，可删除非空目录"));
        resourceService.add(buildKgDocService(qADomainName, "正则表达式方式查找文件", "POST", "/api/v1/directories/update",
            "update_dir", "基于正则表达式查找文件、目录。"));
        resourceService.add(buildKgDocService(qADomainName, "修改目录名称、描述、元数据", "POST", "/api/v1/knowledge-items/update",
            "update_item", "修改目录名称、描述、元数据"));
        resourceService
            .add(buildKgDocService(qADomainName, "下载原文件流", "POST", "/api/v1/download-file", "download_file", "下载原文件流"));

        targetContent.put("resourceService", resourceService);
        return JSON.toJSONString(targetContent);
    }

    /**
     * 组装一条可调用的知识库服务描述（域名、HTTP 方法、路径、action、说明）。
     */
    private JSONObject buildKgDocService(String domainName, String name, String method, String path, String action,
        String description) {
        JSONObject service = new JSONObject(true);
        service.put("domainName", domainName);
        service.put("name", name);
        service.put("method", method);
        service.put("path", path);
        service.put("action", action);
        service.put("description", description);
        return service;
    }

    /**
     * 更新扩展表
     *
     * @param resourceId 资源主键
     * @param type 文档库类型
     * @param resourceCatalogMain 归属目录/分类
     * @return 更新后的扩展实体
     */
    public SsResExtDoc updateSsResExtDoc(Long resourceId, String type, String resourceCatalogMain) {
        SsResExtDoc ssResExtDoc = this.findById(resourceId);
        ssResExtDoc.setResourceId(resourceId);
        ssResExtDoc.setType(type);
        ssResExtDocMapper.updateById(ssResExtDoc);
        return ssResExtDoc;
    }

    /**
     * 页面更新知识库时，仅按当前前端允许编辑的名称、描述刷新 targetContent，
     * sourceContent 保持不变，避免影响导入链的原始内容语义。
     */
    public SsResExtDoc updateSsResExtDocTargetContent(Long resourceId, String type, String resourceName,
                                                      String resourceDesc) {
        SsResExtDoc ssResExtDoc = this.findById(resourceId);
        if (ssResExtDoc == null) {
            ssResExtDoc = new SsResExtDoc();
            ssResExtDoc.setResourceId(resourceId);
        }
        ssResExtDoc.setResourceId(resourceId);
        ssResExtDoc.setType(type);
        ssResExtDoc.setTargetContent(buildUpdatedTargetContent(ssResExtDoc.getTargetContent(), resourceId,
            resourceName, resourceDesc));
        ssResExtDocMapper.updateById(ssResExtDoc);
        return ssResExtDoc;
    }

    private String buildDatasetTemplateContent(Long resourceId, String resourceCode, String resourceName,
                                               String resourceDesc, String ownerType) {
        JSONObject templateRoot = JSON.parseObject(loadKgDocTemplateContent(), Feature.OrderedField);
        JSONObject targetRoot = new JSONObject(true);
        targetRoot.put("resourceId", resourceId);
        targetRoot.put("systemCode", "dataset");
        targetRoot.put("resourceCode", StringUtils.trimToEmpty(resourceCode));
        targetRoot.put("resourceName", StringUtils.trimToEmpty(resourceName));
        targetRoot.put("resourceDesc", StringUtils.trimToEmpty(resourceDesc));
        targetRoot.put("resourceBizType", templateRoot.getString("resourceBizType"));
        targetRoot.put("version", templateRoot.getString("version"));
        targetRoot.put("domainName", StringUtils.trimToEmpty(qADomainName));
        targetRoot.put("domainURL", null);
        targetRoot.put("ownerType", StringUtils.trimToEmpty(ownerType));
        fillKnowledgeRuntimeFields(targetRoot);
        targetRoot.put("headers", new JSONObject(true));

        JSONArray resourceService = templateRoot.getJSONArray("resourceService");
        if (resourceService == null) {
            resourceService = new JSONArray();
        } else {
            resourceService = JSON.parseArray(JSON.toJSONString(resourceService), Feature.OrderedField);
            resourceService.forEach(this::clearUrlRecursively);
        }
        targetRoot.put("resourceService", resourceService);
        return JSON.toJSONString(targetRoot);
    }

    /**
     * 页面更新知识库时，只覆盖 targetContent 中的名称、描述；
     * 若旧 targetContent 缺失，则回退到默认知识库结构后再回填。
     */
    private String buildUpdatedTargetContent(String originalTargetContent, Long resourceId, String resourceName,
                                             String resourceDesc) {
        JSONObject originalRoot = parseTargetContentOrDefault(originalTargetContent);
        JSONObject targetRoot = new JSONObject(true);
        targetRoot.put("resourceId", resourceId);
        targetRoot.put("resourceName", StringUtils.trimToEmpty(resourceName));
        targetRoot.put("resourceDesc", StringUtils.trimToEmpty(resourceDesc));
        for (String key : originalRoot.keySet()) {
            if ("resourceId".equals(key) || "resourceName".equals(key) || "resourceDesc".equals(key)) {
                continue;
            }
            targetRoot.put(key, originalRoot.get(key));
        }
        fillKnowledgeRuntimeFields(targetRoot);
        return JSON.toJSONString(targetRoot);
    }

    /**
     * 知识库类资源统一在 targetContent 根节点补齐实现方式与 Worker 注册类型。
     *
     * @author qin.guoquan
     * @date 2026-04-26 11:20:00
     */
    private void fillKnowledgeRuntimeFields(JSONObject root) {
        resourceTargetJsonBuilder.enrichRoot(root, resourceRuntimeInfoResolver.resolveKnowledge());
    }

    private JSONObject parseTargetContentOrDefault(String originalTargetContent) {
        if (StringUtils.isBlank(originalTargetContent)) {
            return JSON.parseObject(buildKgDocTargetContent(), Feature.OrderedField);
        }
        try {
            JSONObject originalRoot = JSON.parseObject(originalTargetContent, Feature.OrderedField);
            return originalRoot != null ? originalRoot : JSON.parseObject(buildKgDocTargetContent(), Feature.OrderedField);
        } catch (Exception e) {
            return JSON.parseObject(buildKgDocTargetContent(), Feature.OrderedField);
        }
    }

    private String loadKgDocTemplateContent() {
        if (kgDocTemplateContent != null) {
            return kgDocTemplateContent;
        }
        synchronized (this) {
            if (kgDocTemplateContent != null) {
                return kgDocTemplateContent;
            }
            ClassPathResource resource = new ClassPathResource(KG_DOC_TEMPLATE_PATH);
            try (InputStream inputStream = resource.getInputStream()) {
                kgDocTemplateContent = IOUtils.toString(inputStream, StandardCharsets.UTF_8);
                return kgDocTemplateContent;
            } catch (IOException e) {
                throw new IllegalArgumentException("加载知识库JSON模板失败");
            }
        }
    }

    /**
     * 资源模板中的 url 字段统一清空，避免前端页面回填历史调用地址。
     */
    private void clearUrlRecursively(Object node) {
        if (node instanceof JSONObject jsonObject) {
            for (String key : new ArrayList<>(jsonObject.keySet())) {
                if ("url".equals(key)) {
                    jsonObject.put(key, null);
                    continue;
                }
                clearUrlRecursively(jsonObject.get(key));
            }
            return;
        }
        if (node instanceof JSONArray jsonArray) {
            for (Object item : jsonArray) {
                clearUrlRecursively(item);
            }
        }
    }
}
