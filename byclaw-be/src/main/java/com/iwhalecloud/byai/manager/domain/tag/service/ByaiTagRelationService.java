package com.iwhalecloud.byai.manager.domain.tag.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.entity.tag.ByaiTagRelation;
import com.iwhalecloud.byai.manager.mapper.tag.ByaiTagRelationMapper;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

/**
 * 标签关系服务
 */
@Service
public class ByaiTagRelationService {

    private static final Long DEFAULT_MODEL_TAG_ID = 1L;

    @Autowired
    private ByaiTagRelationMapper byaiTagRelationMapper;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 保存标签
     *
     * @param ObjType 类型
     * @param objId 类型标识
     * @param tagId 标签标识
     * @return ByaiTagRelation
     */
    public ByaiTagRelation save(String ObjType, Long objId, Long tagId) {

        ByaiTagRelation byaiTagRelation = new ByaiTagRelation();
        byaiTagRelation.setRelationId(sequenceService.nextVal());
        byaiTagRelation.setTagId(tagId);
        byaiTagRelation.setObjId(objId);
        byaiTagRelation.setObjType(ObjType);
        byaiTagRelation.setCreateTime(new Date());
        byaiTagRelation.setCreatorBy(CurrentUserHolder.getCurrentUserId());
        byaiTagRelationMapper.insert(byaiTagRelation);

        return byaiTagRelation;
    }

    /**
     * 删除标签
     *
     * @param relationId 标签主键
     */
    public void removeById(Long relationId) {
        byaiTagRelationMapper.deleteById(relationId);
    }

    /**
     * @param objType 类型
     * @param tagId 标签
     * @return List<ByaiTagRelation>
     */
    public List<ByaiTagRelation> findTagRelation(String objType, Long tagId) {
        LambdaQueryWrapper<ByaiTagRelation> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiTagRelation::getObjType, objType);
        queryWrapper.eq(ByaiTagRelation::getTagId, tagId);
        return byaiTagRelationMapper.selectList(queryWrapper);
    }

    /**
     * 保存模型-能力关联：先删该模型下能力关联，再按 abilities 列表批量插入 byai_tag_relation。
     *
     * @param modelId 模型主键（保存后得到的 id）
     * @param abilities 能力列表（每项为能力/标签 ID 字符串，写入 tag_id）
     * @param creatorBy 创建人ID，可为 null
     */
    public void saveAimodelAbilities(Long modelId, List<String> abilities, Long creatorBy) {
        if (modelId == null) {
            return;
        }
        LambdaQueryWrapper<ByaiTagRelation> deleteWrapper = new LambdaQueryWrapper<>();
        deleteWrapper.eq(ByaiTagRelation::getObjType, Constants.OBJ_TYPE_AIMODEL);
        deleteWrapper.eq(ByaiTagRelation::getObjId, modelId);
        deleteWrapper.ne(ByaiTagRelation::getTagId, DEFAULT_MODEL_TAG_ID);
        byaiTagRelationMapper.delete(deleteWrapper);
        if (CollectionUtils.isEmpty(abilities)) {
            return;
        }
        Date now = new Date();
        List<ByaiTagRelation> list = new ArrayList<>();
        Set<String> normalizedAbilities = new LinkedHashSet<>(abilities);
        for (String ability : normalizedAbilities) {
            if (StringUtils.isEmpty(ability)) {
                continue;
            }
            Long tagId = Long.valueOf(ability);
            if (DEFAULT_MODEL_TAG_ID.equals(tagId)) {
                continue;
            }
            ByaiTagRelation rel = new ByaiTagRelation();
            rel.setRelationId(sequenceService.nextVal());
            rel.setTagId(tagId);
            rel.setObjId(modelId);
            rel.setObjType(Constants.OBJ_TYPE_AIMODEL);
            rel.setCreateTime(now);
            rel.setCreatorBy(creatorBy);
            list.add(rel);
        }
        if (!list.isEmpty()) {
            byaiTagRelationMapper.insertBatch(list);
        }
    }

}
