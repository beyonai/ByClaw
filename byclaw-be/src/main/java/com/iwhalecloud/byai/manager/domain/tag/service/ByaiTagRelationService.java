package com.iwhalecloud.byai.manager.domain.tag.service;

import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.entity.tag.ByaiTagRelation;
import com.iwhalecloud.byai.manager.mapper.tag.ByaiTagRelationMapper;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

/**
 * 标签关系服务
 */
@Service
public class ByaiTagRelationService {

    /** 能力-模型关联在 byai_tag_relation 中的 obj_type（Story 一体化保存） */
    public static final String OBJ_TYPE_AIMODEL = "AI_MODEL";

    @Autowired
    private ByaiTagRelationMapper byaiTagRelationMapper;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 根据对象类型和对象ID列表批量查询标签ID
     *
     * @param objType 对象类型
     * @param objIds  对象ID列表
     * @return 标签ID列表（去重）
     */
    public List<Long> findTagIdsByObjTypeAndObjIds(String objType, List<Long> objIds) {
        if (CollectionUtils.isEmpty(objIds)) {
            return Collections.emptyList();
        }
        return byaiTagRelationMapper.findTagIdsByObjTypeAndObjIds(objType, objIds);
    }

    /**
     * 按对象类型+对象ID删除该对象下所有标签关系（用于模型能力关联先删后插）
     *
     * @param objType 对象类型（如 byai_aimodel）
     * @param objId   对象ID（如模型主键字符串）
     * @return 删除行数
     */
    public int deleteByObjTypeAndObjId(String objType, String objId) {
        if (objType == null || objId == null) {
            return 0;
        }
        return byaiTagRelationMapper.deleteByObjTypeAndObjId(objType, objId);
    }

    /**
     * 保存模型-能力关联：先删该模型下能力关联，再按 abilities 列表批量插入 byai_tag_relation。
     *
     * @param modelId   模型主键（保存后得到的 id）
     * @param abilities 能力列表（每项为能力/标签 ID 字符串，写入 tag_id）
     * @param creatorBy 创建人ID，可为 null
     */
    public void saveAimodelAbilities(Long modelId, List<String> abilities, Long creatorBy) {
        if (modelId == null || CollectionUtils.isEmpty(abilities)) {
            return;
        }
        String objId = String.valueOf(modelId);
        byaiTagRelationMapper.deleteByObjTypeAndObjId(OBJ_TYPE_AIMODEL, objId);
        Date now = new Date();
        String creatorByStr = creatorBy != null ? String.valueOf(creatorBy) : null;
        List<ByaiTagRelation> list = new ArrayList<>();
        for (String ability : abilities) {
            if (StringUtils.isEmpty(ability)) {
                continue;
            }
            ByaiTagRelation rel = new ByaiTagRelation();
            rel.setRelationId(SequenceService.nextVal());
            rel.setTagId(Long.valueOf(ability));
            rel.setObjId(objId);
            rel.setObjType(OBJ_TYPE_AIMODEL);
            rel.setCreateTime(now);
            rel.setCreatorBy(creatorByStr);
            list.add(rel);
        }
        if (!list.isEmpty()) {
            byaiTagRelationMapper.insertBatch(list);
        }
    }

    /**
     * 批量检查对象是否是重要用户
     *
     * @param objType 对象类型（如：重要用户）
     * @param objIds  对象ID列表（数字员工ID列表）
     * @return 有标签的对象ID列表
     */
    public List<Long> findImportantUserTagIds(String objType, List<Long> objIds) {
        return findTagIdsByObjTypeAndObjIds(objType, objIds);
    }

}


