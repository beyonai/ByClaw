package com.iwhalecloud.byai.manager.domain.staticdata.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.manager.dto.staticdata.SystemConfigListDTO;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.manager.mapper.staticdata.ByaiSystemConfigListMapper;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.staticdata.SystemConfigListGroupVo;
import java.util.Collections;
import java.util.List;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 系统配置列表服务实现类
 */
@Service
public class ByaiSystemConfigListService {

    @Autowired
    private ByaiSystemConfigListMapper byaiSystemConfigListMapper;

    /**
     * 分页查询系统配置列表分组
     *
     * @param qo 查询对象
     * @return PageInfo
     */
    public PageInfo<SystemConfigListGroupVo> selectSystemConfigListGroupByQo(QueryObject qo) {
        Page<SystemConfigListGroupVo> page = PageHelper.startPage(qo.getPageNum(), qo.getPageSize(), true);
        byaiSystemConfigListMapper.selectSystemConfigListGroupByQo(qo);
        return PageHelperUtil.toPageInfo(page.toPageInfo());
    }

    /**
     * 根据ID查询系统配置列表
     *
     * @param paramId 参数ID
     * @return ByaiSystemConfigList
     */
    public ByaiSystemConfigList findById(Long paramId) {
        if (paramId == null) {
            return null;
        }
        return byaiSystemConfigListMapper.selectById(paramId);
    }

    /**
     * 查询所有缓存配置
     *
     * @return ByaiSystemConfigList
     */
    public List<ByaiSystemConfigList> findAll() {
        return byaiSystemConfigListMapper.selectList(new LambdaQueryWrapper<>());
    }

    /**
     * 分组查询
     *
     * @param paramGroupCode 分组编码
     * @return List<ByaiSystemConfigList>
     */
    public List<ByaiSystemConfigList> findByParamGroupCode(String paramGroupCode) {
        if (StringUtil.isEmpty(paramGroupCode)) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<ByaiSystemConfigList> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSystemConfigList::getParamGroupCode, paramGroupCode);
        queryWrapper.orderByAsc(ByaiSystemConfigList::getParamSeq);
        return byaiSystemConfigListMapper.selectList(queryWrapper);
    }

    /**
     * 保存系统配置列表
     *
     * @param byaiSystemConfigList 系统配置列表实体
     */
    public void save(ByaiSystemConfigList byaiSystemConfigList) {
        byaiSystemConfigListMapper.insert(byaiSystemConfigList);
    }

    /**
     * 更新系统配置列表
     *
     * @param byaiSystemConfigList 系统配置列表实体
     */
    public void updateById(ByaiSystemConfigList byaiSystemConfigList) {
        if (byaiSystemConfigList == null || byaiSystemConfigList.getParamId() == null) {
            return;
        }
        byaiSystemConfigListMapper.updateById(byaiSystemConfigList);
    }

    /**
     * 删除系统配置列表
     *
     * @param paramId 参数ID
     */
    public void removeById(Long paramId) {
        if (paramId == null) {
            return;
        }
        byaiSystemConfigListMapper.deleteById(paramId);
    }

    /**
     * 查询记录数
     *
     * @param paramGroupCode 分组编码
     * @param paramGroupName 分组名称
     * @return long
     */
    public long countSystemConfigList(String paramGroupCode, String paramGroupName) {
        LambdaQueryWrapper<ByaiSystemConfigList> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.and(wrapper -> {
            wrapper.eq(ByaiSystemConfigList::getParamGroupCode, paramGroupCode).or()
                .eq(ByaiSystemConfigList::getParamGroupName, paramGroupName);
        });
        return byaiSystemConfigListMapper.selectCount(queryWrapper);
    }

    /**
     * 根据分组编码删除系统配置列表
     *
     * @param paramGroupCode 分组编码
     */
    public void removeByByGroupCode(String paramGroupCode) {

        if (StringUtils.isBlank(paramGroupCode)) {
            return;
        }

        LambdaQueryWrapper<ByaiSystemConfigList> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSystemConfigList::getParamGroupCode, paramGroupCode);
        byaiSystemConfigListMapper.delete(queryWrapper);
    }

    /**
     * 查询详情
     *
     * @param paramGroupCode 分组编码
     * @return SystemConfigListDTO
     */
    public SystemConfigListDTO getByParamGroupCode(String paramGroupCode) {
        return byaiSystemConfigListMapper.selectByParamGroupCode(paramGroupCode);
    }

}
