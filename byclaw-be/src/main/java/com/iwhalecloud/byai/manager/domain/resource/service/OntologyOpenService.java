package com.iwhalecloud.byai.manager.domain.resource.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.domain.resource.enums.OperationTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyActionSaveRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBatchSaveRequest;
import com.iwhalecloud.byai.manager.entity.ontology.SsResExtOntology;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.ontology.SsResExtOntologyMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import jakarta.validation.Valid;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/*
 * 对象管理服务
 */
@Service
public class OntologyOpenService {

    public static final Logger LOGGER = LoggerFactory.getLogger(OntologyOpenService.class);

    @Autowired
    private OperationLogService operationLogService;

    @Autowired
    private SsResExtOntologyMapper ssResExtOntologyMapper;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private OntologyService ontologyService;

    /**
     * 批量保存对象（支持首次创建和修改）。 与 saveOntologyInfos 不同，本方法不要求 resourceId 对应的资源已存在。 当 resourceId
     * 为空或对应资源不存在时，自动创建新对象资源；否则更新已有对象的基本信息。 创建/更新后再依次保存属性、动作和虚拟动作，确保 resourceId 在整个流程中正确传递。
     *
     * @param request 保存请求（resourceId 可选：为空时新建，不为空且已存在时更新）
     * @return 包含 object、attributesList、actionInfos 的结果 Map
     */
    public Map<String, Object> saveBatchOpen(@Valid OntologyActionSaveRequest request) {
        Long resourceId = request.getResourceId();
        // 根据 resourceId 判断是新建还是修改
        SsResource resource = null;
        if (resourceId != null) {
            resource = ssResourceService.findById(resourceId);
        }

        Map<String, Object> resultMap = new HashMap<>();

        if (resource == null) {
            // 新建场景：创建对象资源，并将生成的 resourceId 回写到 request，保证后续方法拿到正确的 ID
            resource = createOntologyResourceFromRequest(request);
            request.setResourceId(resource.getResourceId());
            resultMap.put("object", resource);
        }
        else {
            // 修改场景：更新对象基本信息
            ontologyService.processObjectBasicInfo(request, resourceId, resultMap);
        }

        // 保存对象属性（增删改）
        ontologyService.processObjectAttributes(request, request.getResourceId(), resultMap);

        // 保存动作及动作属性、关联数据
        List<OntologyBatchSaveRequest.ActionInfo> actionInfos = ontologyService.saveOntologyActions(request);

        // 创建虚拟动作
        ontologyService.createVirtualActions(request.getResourceId(), resource.getResourceName(),
            request.getSourceType());

        resultMap.put("actionInfos", actionInfos);

        return resultMap;
    }

    /**
     * 根据 OntologyActionSaveRequest 创建新的对象资源（用于 saveBatchForOther 首次创建场景）。 逻辑参考 ，复用同样的建表、鉴权和日志记录流程。
     *
     * @param request 保存请求
     * @return 新创建的 SsResource
     */
    private SsResource createOntologyResourceFromRequest(OntologyActionSaveRequest request) {
        // 基础字段校验
        if (StringUtils.isBlank(request.getName())) {
            throw new BaseException(I18nUtil.get("ontology.object.name.not.null"));
        }
        if (request.getCatalogId() == null) {
            throw new BaseException(I18nUtil.get("ontology.catalog.id.not.null"));
        }
        if (request.getSourceType() == null) {
            throw new BaseException(I18nUtil.get("ontology.source.type.not.null"));
        }

        // 对象类型，默认 OBJECT
        String bizType = StringUtils.isNotBlank(request.getType()) ? request.getType()
            : ResourceBizType.OBJECT.getCode();

        // 同名对象校验
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceName, request.getName());
        queryWrapper.eq(SsResource::getCreateBy, CurrentUserHolder.getCurrentUserId());
        queryWrapper.eq(SsResource::getResourceBizType, bizType);
        Long count = ssResourceMapper.selectCount(queryWrapper);
        if (count > 0) {
            throw new BaseException(I18nUtil.get("ontology.object.name.exists"));
        }

        // 构建资源对象
        SsResource resource = new SsResource();
        resource.setResourceId(SequenceService.nextVal());
        resource.setResourceName(request.getName());
        resource.setResourceDesc(request.getDesc());
        resource.setResourceRVerid(0L);
        resource.setResourceDVerid(1L);
        resource.setResourceSourcePkId(request.getDocId());
        resource.setCatalogId(request.getCatalogId());
        resource.setResourceBizType(bizType);
        resource.setResourceCode(bizType + "_" + resource.getResourceId());
        resource.setResourceType(ontologyService.convertSourceTypeToResourceType(request.getSourceType()));
        resource.setSystemCode("BYAI");
        resource.setResourceStatus(ResourceStatus.DRAFT.getNum());

        setDateUserInfo(resource, ssResourceMapper);
        if (LOGGER.isInfoEnabled()) {
            LOGGER.info("saveBatchForOther创建新对象，resourceId={}, resourceName={}", resource.getResourceId(),
                resource.getResourceName());
        }

        // 写入对象扩展表
        SsResExtOntology ssResExtOntology = new SsResExtOntology();
        ssResExtOntology.setResourceId(resource.getResourceId());
        ssResExtOntology.setPid(request.getPid());
        ssResExtOntologyMapper.insert(ssResExtOntology);

        // 鉴权

        // 操作日志
        operationLogService.recordOperationLog(resource, OperationTypeEnum.CREATE);

        return resource;
    }

    static void setDateUserInfo(SsResource resource, SsResourceMapper ssResourceMapper) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        resource.setCreateBy(currentUserId);
        resource.setCreateTime(new Date());
        resource.setUpdateBy(currentUserId);
        resource.setUpdateTime(new Date());

        Long enterpriseId = CurrentUserHolder.getEnterpriseId();
        if (enterpriseId != null) {
            resource.setComAcctId(enterpriseId);
        }

        ssResourceMapper.insert(resource);
    }

}
