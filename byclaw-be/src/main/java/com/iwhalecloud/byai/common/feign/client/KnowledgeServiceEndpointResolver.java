package com.iwhalecloud.byai.common.feign.client;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDocService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.List;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 知识库服务端点解析器。
 * 这个类专门负责根据系统配置 dataset.system 和本次请求携带的 knCode，
 * 统一计算出当前知识库调用应该使用哪个服务端点。
 * 若 dataset.system 为空，则表示使用百应自有知识库，统一返回服务发现端点，服务名取 qADomainName；
 * 若 dataset.system 有值，则表示使用第三方知识库，会按 knCode 找到导入的知识库资源，
 * 再从其扩展表 targetContent 根节点的 domainURL 中提取第三方默认地址，返回直连端点。
 * 它只做“判定和解析”，不直接发 HTTP 请求；真正的调用执行仍由 FeignPythonBuildService 负责。
 *
 * @author qin.guoquan
 * @date 2026-04-22 10:30:00
 */
@Service
public class KnowledgeServiceEndpointResolver {

    private static final Logger LOGGER = LoggerFactory.getLogger(KnowledgeServiceEndpointResolver.class);

    private final SsResourceService ssResourceService;

    private final SsResExtDocService ssResExtDocService;

    @Value("${dataset.system:}")
    private String datasetSystem;

    @Value("${spring.application.qADomainName:byclaw-qa-manager}")
    private String qaDomainName;

    /**
     * 构造知识库服务端点解析器。
     */
    public KnowledgeServiceEndpointResolver(SsResourceService ssResourceService, SsResExtDocService ssResExtDocService) {
        this.ssResourceService = ssResourceService;
        this.ssResExtDocService = ssResExtDocService;
    }

    /**
     * dataset.system 为空时统一走百应自有知识库服务发现；
     * 若当前 knCode 能定位到知识库 JSON，则优先使用其 domainName 作为服务名；
     * 非空时优先按 knCode 查导入知识库 JSON 的 domainURL，查不到则回退到服务发现，避免阻断主流程。
     */
    public KnowledgeServiceEndpoint resolveByKnCode(String knCode) {
        if (StringUtils.isBlank(datasetSystem)) {
            String domainName = extractDomainNameByKnCode(knCode);
            return KnowledgeServiceEndpoint.forDiscovery(StringUtils.defaultIfBlank(domainName, qaDomainName));
        }
        if (StringUtils.isBlank(knCode)) {
            LOGGER.warn("third-party知识库模式下缺少knCode，回退走服务发现, datasetSystem={}", datasetSystem);
            return KnowledgeServiceEndpoint.forDiscovery(qaDomainName);
        }

        List<SsResource> resourceList = ssResourceService.findKnowledgeResourcesByCode(knCode);
        if (resourceList.isEmpty()) {
            LOGGER.warn("third-party知识库模式下未找到知识库资源，回退走服务发现, datasetSystem={}, knCode={}",
                datasetSystem, knCode);
            return KnowledgeServiceEndpoint.forDiscovery(qaDomainName);
        }
        if (resourceList.size() > 1) {
            throw new IllegalArgumentException("知识库编码重复，请先清理历史数据: " + knCode);
        }

        SsResExtDoc extDoc = ssResExtDocService.findById(resourceList.get(0).getResourceId());
        String domainUrl = extractDomainUrl(extDoc);
        if (StringUtils.isBlank(domainUrl)) {
            throw new IllegalArgumentException("第三方知识库targetContent缺少domainURL: " + knCode);
        }
        return KnowledgeServiceEndpoint.forDirectUrl(domainUrl);
    }

    /**
     * 从知识库扩展表 targetContent 中提取第三方默认 domainURL。
     *
     */
    private String extractDomainUrl(SsResExtDoc extDoc) {
        if (extDoc == null || StringUtils.isBlank(extDoc.getTargetContent())) {
            return null;
        }
        try {
            JSONObject root = JSON.parseObject(extDoc.getTargetContent(), Feature.OrderedField);
            return root == null ? null : StringUtils.trimToNull(root.getString("domainURL"));
        } catch (Exception e) {
            throw new IllegalArgumentException("第三方知识库targetContent解析失败", e);
        }
    }

    /**
     * 百应自有知识库模式下，优先从知识库 JSON 根节点提取 domainName 作为服务发现服务名。
     *
     * @author qin.guoquan
     * @date 2026-04-22 11:10:00
     */
    private String extractDomainNameByKnCode(String knCode) {
        if (StringUtils.isBlank(knCode)) {
            return null;
        }
        List<SsResource> resourceList = ssResourceService.findKnowledgeResourcesByCode(knCode);
        if (resourceList.size() != 1) {
            return null;
        }
        SsResExtDoc extDoc = ssResExtDocService.findById(resourceList.get(0).getResourceId());
        if (extDoc == null || StringUtils.isBlank(extDoc.getTargetContent())) {
            return null;
        }
        try {
            JSONObject root = JSON.parseObject(extDoc.getTargetContent(), Feature.OrderedField);
            return root == null ? null : StringUtils.trimToNull(root.getString("domainName"));
        }
        catch (Exception e) {
            LOGGER.warn("解析知识库JSON的domainName失败，回退qADomainName, knCode={}", knCode, e);
            return null;
        }
    }
}
