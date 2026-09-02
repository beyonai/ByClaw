package com.iwhalecloud.byai.manager.domain.resource.service.impl;

import com.alibaba.fastjson2.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.dto.resource.SsResourceRelDetailDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDbDataset;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtTool;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtToolKit;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDbDatasetMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDocMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtToolKitMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtToolMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceRelDetailMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

import static com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService.GROUP_MEMBER_REL_TYPE;
import static com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService.MEMBER_SCHEMA;

/**
 * 资源关联明细表 Service 实现。
 */
@Service
public class SsResourceRelDetailServiceImpl extends ServiceImpl<SsResourceRelDetailMapper, SsResourceRelDetail>
    implements SsResourceRelDetailService {

    private static final Logger logger = LoggerFactory.getLogger(SsResourceRelDetailServiceImpl.class);

    @Autowired
    private SsResourceRelDetailMapper ssResourceRelDetailMapper;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SsResExtDocMapper ssResExtDocMapper;

    @Autowired
    private SsResExtToolMapper ssResExtToolMapper;

    @Autowired
    private SsResExtToolKitMapper ssResExtToolKitMapper;

    @Autowired
    private SsResExtDbDatasetMapper ssResExtDbDatasetMapper;

    /**
     * 按资源 ID 查询关联明细。
     *
     * @param resourceId 资源标识
     * @return 关联明细列表
     */
    @Override
    public List<SsResourceRelDetail> findByResourceId(Long resourceId) {
        LambdaQueryWrapper<SsResourceRelDetail> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceRelDetail::getResourceId, resourceId);
        return ssResourceRelDetailMapper.selectList(queryWrapper);
    }

    /**
     * 删除以该资源为主或为从的全部关联明细。
     *
     * @param resourceId 资源标识
     */
    @Override
    public void removeAllByResourceIdOrRelResourceId(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        LambdaQueryWrapper<SsResourceRelDetail> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceRelDetail::getResourceId, resourceId).or().eq(SsResourceRelDetail::getRelResourceId,
            resourceId);
        ssResourceRelDetailMapper.delete(queryWrapper);
    }

    /**
     * 查询数字员工关联技能列表（OpenAPI），含子表扩展数据。
     *
     * @param resourceId 数字员工资源 ID
     * @return 技能明细列表
     */
    @Override
    public List<SsResourceRelDetailDTO> querySkillsForOpenApi(Long resourceId) {
        if (resourceId == null) {
            logger.warn("查询数字员工技能列表失败：resourceId不能为空");
            return new ArrayList<>();
        }

        List<SsResourceRelDetailDTO> relList = ssResourceRelDetailMapper.findByResourceIdAsDetail(resourceId);
        List<Long> relResourceIds = collectSkillResourceIds(relList);
        if (relResourceIds.isEmpty()) {
            return new ArrayList<>();
        }

        List<SsResource> skills = ssResourceMapper.selectBatchIds(relResourceIds);
        if (CollectionUtils.isEmpty(skills)) {
            return new ArrayList<>();
        }

        Map<Long, SsResourceRelDetailDTO> dtoMap = new LinkedHashMap<>();
        List<Long> kgDocIds = new ArrayList<>();
        List<Long> toolIds = new ArrayList<>();
        List<Long> toolkitIds = new ArrayList<>();
        List<Long> kgDbIds = new ArrayList<>();
        buildSkillDtoMap(skills, dtoMap, kgDocIds, toolIds, toolkitIds, kgDbIds);
        fillExtData(dtoMap, kgDocIds, toolIds, toolkitIds, kgDbIds);

        logger.info("查询数字员工技能列表成功。resourceId: {}, 技能数量: {}", resourceId, dtoMap.size());
        return new ArrayList<>(dtoMap.values());
    }

    /**
     * 从关联关系列表提取去重后的技能资源 ID。
     *
     * @param relList 关联明细 DTO 列表
     * @return 技能资源 ID 列表
     */
    private List<Long> collectSkillResourceIds(List<SsResourceRelDetailDTO> relList) {
        return relList.stream().map(SsResourceRelDetailDTO::getRelResourceId).filter(Objects::nonNull).distinct()
            .collect(Collectors.toList());
    }

    /**
     * 构建技能 DTO，并按业务类型收集待查扩展子表的资源 ID。
     *
     * @param skills     技能资源列表
     * @param dtoMap     资源 ID → 技能 DTO
     * @param kgDocIds   文档知识库资源 ID
     * @param toolIds    工具资源 ID
     * @param toolkitIds 工具集资源 ID
     * @param kgDbIds    数据库知识库资源 ID
     */
    private void buildSkillDtoMap(List<SsResource> skills, Map<Long, SsResourceRelDetailDTO> dtoMap,
                                  List<Long> kgDocIds, List<Long> toolIds, List<Long> toolkitIds, List<Long> kgDbIds) {
        for (SsResource skill : skills) {
            SsResourceRelDetailDTO dto = new SsResourceRelDetailDTO();
            dto.setResourceId(skill.getResourceId());
            dto.setResourceCode(skill.getResourceCode());
            dto.setResourceName(skill.getResourceName());
            dto.setResourceDesc(skill.getResourceDesc());
            dto.setResourceBizType(skill.getResourceBizType());
            dtoMap.put(skill.getResourceId(), dto);

            String bizType = skill.getResourceBizType();
            if ("KG_DOC".equals(bizType)) {
                kgDocIds.add(skill.getResourceId());
                dto.setExtDoc(new SsResExtDoc());
            } else if ("TOOL".equals(bizType)) {
                toolIds.add(skill.getResourceId());
                dto.setExtTool(new SsResExtTool());
            } else if ("TOOLKIT".equals(bizType)) {
                toolkitIds.add(skill.getResourceId());
                dto.setExtToolKit(new SsResExtToolKit());
            } else if ("KG_DB".equals(bizType)) {
                kgDbIds.add(skill.getResourceId());
                dto.setExtDbDatasets(new ArrayList<>());
            }
        }
    }

    /**
     * 批量查询并填充技能扩展子表数据。
     *
     * @param dtoMap     技能 DTO 映射
     * @param kgDocIds   文档知识库资源 ID
     * @param toolIds    工具资源 ID
     * @param toolkitIds 工具集资源 ID
     * @param kgDbIds    数据库知识库资源 ID
     */
    private void fillExtData(Map<Long, SsResourceRelDetailDTO> dtoMap, List<Long> kgDocIds, List<Long> toolIds,
                             List<Long> toolkitIds, List<Long> kgDbIds) {
        if (!kgDocIds.isEmpty()) {
            List<SsResExtDoc> extDocs = ssResExtDocMapper.selectListByResourceIds(kgDocIds);
            for (SsResExtDoc extDoc : extDocs) {
                SsResourceRelDetailDTO dto = dtoMap.get(extDoc.getResourceId());
                if (dto != null) {
                    dto.setExtDoc(extDoc);
                }
            }
        }
        if (!toolIds.isEmpty()) {
            List<SsResExtTool> extTools = ssResExtToolMapper.selectListByResourceIds(toolIds);
            for (SsResExtTool extTool : extTools) {
                SsResourceRelDetailDTO dto = dtoMap.get(extTool.getResourceId());
                if (dto != null) {
                    dto.setExtTool(extTool);
                }
            }
        }
        if (!toolkitIds.isEmpty()) {
            List<SsResExtToolKit> extToolKits = ssResExtToolKitMapper.selectListByResourceIds(toolkitIds);
            for (SsResExtToolKit extToolKit : extToolKits) {
                SsResourceRelDetailDTO dto = dtoMap.get(extToolKit.getResourceId());
                if (dto != null) {
                    dto.setExtToolKit(extToolKit);
                }
            }
        }
        if (!kgDbIds.isEmpty()) {
            List<SsResExtDbDataset> allDatasets = ssResExtDbDatasetMapper.selectListByResourceIds(kgDbIds);
            Map<Long, List<SsResExtDbDataset>> grouped = allDatasets.stream()
                .collect(Collectors.groupingBy(SsResExtDbDataset::getResourceId));
            for (Map.Entry<Long, List<SsResExtDbDataset>> entry : grouped.entrySet()) {
                SsResourceRelDetailDTO dto = dtoMap.get(entry.getKey());
                if (dto != null) {
                    dto.setExtDbDatasets(entry.getValue());
                }
            }
        }
    }

    /**
     * 按主资源与关联资源精确查询关联明细。
     *
     * @param resourceId    主资源 ID
     * @param relResourceId 关联资源 ID
     * @return 关联明细列表
     */
    @Override
    public List<SsResourceRelDetail> find(Long resourceId, Long relResourceId) {
        LambdaQueryWrapper<SsResourceRelDetail> lambdaQueryWrapper = new LambdaQueryWrapper<>();
        lambdaQueryWrapper.eq(SsResourceRelDetail::getResourceId, resourceId);
        lambdaQueryWrapper.eq(SsResourceRelDetail::getRelResourceId, relResourceId);
        return ssResourceRelDetailMapper.selectList(lambdaQueryWrapper);
    }

    /**
     * 统计某资源被多少条关系明细引用。
     *
     * @param relResourceId 被关联资源 ID
     * @return 引用条数
     */
    @Override
    public long countByRelResourceId(Long relResourceId) {
        if (relResourceId == null) {
            return 0;
        }
        LambdaQueryWrapper<SsResourceRelDetail> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SsResourceRelDetail::getRelResourceId, relResourceId);
        return ssResourceRelDetailMapper.selectCount(wrapper);
    }

    /**
     * 保存数字员工组成员关系。
     *
     * @param resourceId    员工组资源 ID
     * @param relResourceId 成员数字员工资源 ID
     * @param teamRole      团队角色
     * @param sortOrder     排序
     * @return 新建的关联明细
     */
    @Override
    public SsResourceRelDetail saveDigEmployeeGroupRelDetail(Long resourceId, Long relResourceId, String teamRole,
                                                             Integer sortOrder) {
        JSONObject info = new JSONObject();
        info.put("schemaVersion", MEMBER_SCHEMA);
        info.put("teamRole", teamRole);
        info.put("sortOrder", sortOrder);
        SsResourceRelDetail ssResourceRelDetail = new SsResourceRelDetail();
        ssResourceRelDetail.setResourceRelDetailId(sequenceService.nextVal());
        ssResourceRelDetail.setResourceId(resourceId);
        ssResourceRelDetail.setRelResourceId(relResourceId);
        ssResourceRelDetail.setRelResourceInfo(info.toJSONString());
        ssResourceRelDetail.setRelTypeName(GROUP_MEMBER_REL_TYPE);
        ssResourceRelDetail.setRelStatus(1);
        ssResourceRelDetail.setCreateBy(CurrentUserHolder.getCurrentUserId());
        ssResourceRelDetail.setCreateTime(new Date());
        ssResourceRelDetail.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        ssResourceRelDetail.setUpdateTime(new Date());
        ssResourceRelDetail.setComAcctId(CurrentUserHolder.getEnterpriseId());
        ssResourceRelDetailMapper.insert(ssResourceRelDetail);
        return ssResourceRelDetail;
    }
}
