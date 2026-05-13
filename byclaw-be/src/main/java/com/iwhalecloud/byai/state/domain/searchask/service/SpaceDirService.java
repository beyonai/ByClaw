package com.iwhalecloud.byai.state.domain.searchask.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.manager.entity.searchask.SpaceDir;
import com.iwhalecloud.byai.manager.mapper.searchask.SpaceDirMapper;
import com.iwhalecloud.byai.manager.qo.searchask.CollectResourceQo;
import com.iwhalecloud.byai.manager.qo.searchask.EnterpriseKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.PersonalKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.SelectedKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.SkillResourceQo;
import com.iwhalecloud.byai.manager.qo.searchask.SpaceResourceQo;
import com.iwhalecloud.byai.manager.vo.searchask.SpaceKbResourceVo;
import com.iwhalecloud.byai.manager.vo.searchask.SpaceResourceVo;
import com.iwhalecloud.byai.common.constants.searchask.SpaceDirType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.Date;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-03-04 09:33:44
 * @description TODO
 */
@Service
public class SpaceDirService {

    @Autowired
    private SpaceDirMapper spaceDirMapper;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 查询导入对象
     *
     * @param importResourceQo 查询
     * @return ResponseUtil
     */
    public List<SpaceResourceVo> listImportResource(SpaceResourceQo importResourceQo) {
        return spaceDirMapper.listImportResource(importResourceQo);
    }

    /**
     * 查询收藏夹内容
     * 
     * @param collectResourceQo 查询对象
     * @return SpaceResourceVo
     */
    public List<SpaceResourceVo> listCollectResource(CollectResourceQo collectResourceQo) {
        return spaceDirMapper.listCollectResource(collectResourceQo);
    }

    /**
     * 查询已经选择的
     * 
     * @param selectedKbQo 查询对象
     * @return List<SpaceResourceVo>
     */
    public List<SpaceKbResourceVo> listSelectedKb(SelectedKbQo selectedKbQo) {
        return spaceDirMapper.listSelectedKb(selectedKbQo);
    }

    /**
     * 个人知识库
     *
     * @param personalKbQo 查询对象
     * @return List<SpaceResourceVo>
     */
    public PageInfo<SpaceResourceVo> listPersonalKb(PersonalKbQo personalKbQo) {

        int pageNum = personalKbQo.getPageNum();
        int pageSize = personalKbQo.getPageSize();

        Page<SpaceResourceVo> page = PageHelper.startPage(pageNum, pageSize);
        spaceDirMapper.listPersonalKb(personalKbQo);

        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 查询企业知识库
     * 
     * @param enterpriseKbQo 查询对象
     * @return PageInfo
     */
    public PageInfo<SpaceKbResourceVo> listEnterpriseKb(EnterpriseKbQo enterpriseKbQo) {

        int pageNum = enterpriseKbQo.getPageNum();
        int pageSize = enterpriseKbQo.getPageSize();

        Page<SpaceKbResourceVo> page = PageHelper.startPage(pageNum, pageSize);
        spaceDirMapper.listEnterpriseKb(enterpriseKbQo);

        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 查询技能
     *
     * @param skillResourceQo 查询对象
     * @return List
     */
    public List<SpaceResourceVo> listSkills(SkillResourceQo skillResourceQo) {
        return spaceDirMapper.listSkills(skillResourceQo);
    }

    /**
     * 查找会话目录
     * 
     * @param sessionId 会话标识
     * @param dirType 目录类型
     * @return SpaceDir
     */
    public SpaceDir findSpaceDir(Long sessionId, String dirType) {
        LambdaQueryWrapper<SpaceDir> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SpaceDir::getSessionId, sessionId);
        queryWrapper.eq(SpaceDir::getDirType, dirType);
        return spaceDirMapper.selectOne(queryWrapper);
    }

    /**
     * 查找会话目录
     *
     * @param sessionId 会话标识
     * @param name 会话
     * @param spaceDirType 目录类型
     * @return SpaceDir
     */
    public SpaceDir createSpaceDir(Long sessionId, String name, String spaceDirType) {
        SpaceDir spaceDir = new SpaceDir();
        spaceDir.setDirId(sequenceService.nextVal());
        spaceDir.setParentDirId(-1L);
        spaceDir.setSessionId(sessionId);
        spaceDir.setName(name);
        spaceDir.setDirType(spaceDirType);
        spaceDir.setSort(1);
        spaceDir.setCreateBy(CurrentUserHolder.getCurrentUserId());
        spaceDir.setCreateTime(new Date());
        spaceDirMapper.insert(spaceDir);
        return spaceDir;
    }

    /**
     * 查找或者创建对应session的目录，如果不存在新建一个返回
     *
     * @param sessionId 会话
     * @param dirType 目录类型
     * @return SpaceDir
     */
    public SpaceDir findOrCreateSpaceDir(Long sessionId, String dirType) {
        SpaceDir spaceDir = this.findSpaceDir(sessionId, dirType);
        if (spaceDir == null) {
            String name = this.getNameByDirType(dirType);
            spaceDir = this.createSpaceDir(sessionId, name, dirType);
        }
        return spaceDir;
    }

    /**
     * 根据类型获取目录名称
     *
     * @param dirType 目录类型
     * @return String
     */
    public String getNameByDirType(String dirType) {

        if (SpaceDirType.DIR_TYPE_IMPORT.equalsIgnoreCase(dirType)) {
            // 用户导入来源
            return I18nUtil.get("searchask.spaceDir.name.import");
        }
        else if (SpaceDirType.DIR_TYPE_WEB_SEARCH.equalsIgnoreCase(dirType)) {
            // 联网检索
            return I18nUtil.get("searchask.spaceDir.name.web.search");
        }
        else if (SpaceDirType.DIR_TYPE_PERSONAL_KB.equalsIgnoreCase(dirType)) {
            // 个人知识库
            return I18nUtil.get("searchask.spaceDir.name.personal.kb");
        }
        else if (SpaceDirType.DIR_TYPE_ENTERPRISE_KB.equalsIgnoreCase(dirType)) {
            // 企业知识库
            return I18nUtil.get("searchask.spaceDir.name.enterprise.kb");
        }
        else if (SpaceDirType.DIR_TYPE_DING_CHAT.equalsIgnoreCase(dirType)) {
            // 钉钉聊天记录
            return I18nUtil.get("searchask.spaceDir.name.ding.chat");
        }
        else if (SpaceDirType.DIR_TYPE_COLLECT.equalsIgnoreCase(dirType)) {
            // 收藏夹
            return I18nUtil.get("searchask.spaceDir.name.collect");
        }
        // 其他
        return I18nUtil.get("searchask.spaceDir.name.other");
    }

}
