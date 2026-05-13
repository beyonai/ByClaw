package com.iwhalecloud.byai.manager.domain.resource.service.ontology;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.ontology.ByaiDbresourceRel;
import com.iwhalecloud.byai.manager.mapper.ontology.ByaiDbresourceRelMapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.util.List;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 数据库资源关联表服务类
 */
@Service
public class ByaiDbresourceRelService {

    @Autowired
    private ByaiDbresourceRelMapper byaiDbresourceRelMapper;

    /**
     * 根据主键查询
     *
     * @param relId 关联关系ID
     * @return 关联关系
     */
    public ByaiDbresourceRel getById(Long relId) {
        if (relId == null) {
            throw new BaseException(I18nUtil.get("dbresource.rel.id.not.null"));
        }
        return byaiDbresourceRelMapper.selectById(relId);
    }

    /**
     * 根据用户ID查询关联关系列表
     *
     * @param objId 用户ID
     * @return 关联关系列表
     */
    public List<ByaiDbresourceRel> findByObjId(Long objId) {
        if (objId == null) {
            throw new BaseException(I18nUtil.get("dbresource.user.id.not.null"));
        }
        return byaiDbresourceRelMapper.findByObjId(objId);
    }

    /**
     * 根据用户ID和对象类型查询关联关系列表
     *
     * @param objId   用户ID
     * @param objType 对象类型
     * @return 关联关系列表
     */
    public List<ByaiDbresourceRel> findByObjIdAndObjType(Long objId, String objType) {
        if (objId == null) {
            throw new BaseException(I18nUtil.get("dbresource.user.id.not.null"));
        }
        return byaiDbresourceRelMapper.findByObjIdAndObjType(objId, objType);
    }

    /**
     * 根据库ID查询关联关系列表
     *
     * @param recordId 库ID
     * @return 关联关系列表
     */
    public List<ByaiDbresourceRel> findByRecordId(Long recordId) {
        if (recordId == null) {
            throw new BaseException(I18nUtil.get("dbresource.record.id.not.null"));
        }
        return byaiDbresourceRelMapper.findByRecordId(recordId);
    }

    /**
     * 根据用户ID和库ID查询关联关系
     *
     * @param objId    用户ID
     * @param recordId 库ID
     * @return 关联关系
     */
    public ByaiDbresourceRel findByObjIdAndRecordId(Long objId, Long recordId) {
        if (objId == null) {
            throw new BaseException(I18nUtil.get("dbresource.user.id.not.null"));
        }
        if (recordId == null) {
            throw new BaseException(I18nUtil.get("dbresource.record.id.not.null"));
        }
        return byaiDbresourceRelMapper.findByObjIdAndRecordId(objId, recordId);
    }

    /**
     * 保存关联关系
     *
     * @param byaiDbresourceRel 关联关系实体
     * @return 保存结果
     */
    @Transactional(rollbackFor = Exception.class)
    public boolean save(ByaiDbresourceRel byaiDbresourceRel) {
        if (byaiDbresourceRel == null) {
            throw new BaseException(I18nUtil.get("dbresource.rel.entity.not.null"));
        }
        if (byaiDbresourceRel.getObjId() == null) {
            throw new BaseException(I18nUtil.get("dbresource.user.id.not.null"));
        }
        if (byaiDbresourceRel.getRecordId() == null) {
            throw new BaseException(I18nUtil.get("dbresource.record.id.not.null"));
        }
        
        // 如果objType为空，设置默认值
        if (StringUtils.isBlank(byaiDbresourceRel.getObjType())) {
            byaiDbresourceRel.setObjType("USER");
        }

        return byaiDbresourceRelMapper.insert(byaiDbresourceRel) > 0;

    }

    /**
     * 更新关联关系
     *
     * @param byaiDbresourceRel 关联关系实体
     * @return 更新结果
     */
    @Transactional(rollbackFor = Exception.class)
    public boolean updateById(ByaiDbresourceRel byaiDbresourceRel) {
        if (byaiDbresourceRel == null) {
            throw new BaseException(I18nUtil.get("dbresource.rel.entity.not.null"));
        }
        if (byaiDbresourceRel.getRelId() == null) {
            throw new BaseException(I18nUtil.get("dbresource.rel.id.not.null"));
        }
        return byaiDbresourceRelMapper.updateById(byaiDbresourceRel) > 0;
    }

    /**
     * 根据主键删除
     *
     * @param relId 关联关系ID
     * @return 删除结果
     */
    @Transactional(rollbackFor = Exception.class)
    public boolean deleteById(Long relId) {
        if (relId == null) {
            throw new BaseException(I18nUtil.get("dbresource.rel.id.not.null"));
        }
        return byaiDbresourceRelMapper.deleteById(relId) > 0;
    }

    /**
     * 根据用户ID删除关联关系
     *
     * @param objId 用户ID
     * @return 删除的记录数
     */
    @Transactional(rollbackFor = Exception.class)
    public int deleteByObjId(Long objId) {
        if (objId == null) {
            throw new BaseException(I18nUtil.get("dbresource.user.id.not.null"));
        }
        return byaiDbresourceRelMapper.deleteByObjId(objId);
    }

    /**
     * 根据库ID删除关联关系
     *
     * @param recordId 库ID
     * @return 删除的记录数
     */
    @Transactional(rollbackFor = Exception.class)
    public int deleteByRecordId(Long recordId) {
        if (recordId == null) {
            throw new BaseException(I18nUtil.get("dbresource.record.id.not.null"));
        }
        return byaiDbresourceRelMapper.deleteByRecordId(recordId);
    }

    /**
     * 批量保存关联关系
     *
     * @param list 关联关系列表
     * @return 保存的记录数
     */
    @Transactional(rollbackFor = Exception.class)
    public int saveBatch(List<ByaiDbresourceRel> list) {
        if (list == null || list.isEmpty()) {
            return 0;
        }
        return byaiDbresourceRelMapper.insertBatch(list);
    }

    /**
     * 查询所有关联关系
     *
     * @return 关联关系列表
     */
    public List<ByaiDbresourceRel> listAll() {
        return byaiDbresourceRelMapper.selectList(new LambdaQueryWrapper<>());
    }
}

