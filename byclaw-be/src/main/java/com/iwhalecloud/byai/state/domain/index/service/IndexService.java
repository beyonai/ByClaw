package com.iwhalecloud.byai.state.domain.index.service;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.manager.qo.index.AuthResourceQo;
import com.iwhalecloud.byai.manager.qo.index.DiscoverQo;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.qo.index.MyCreatedQo;
import com.iwhalecloud.byai.manager.qo.index.MyUsualQo;
import com.iwhalecloud.byai.manager.qo.index.RecentlyAddedQo;
import com.iwhalecloud.byai.manager.mapper.index.IndexMapper;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.manager.vo.index.AuthResourceVo;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketExtVo;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketVo;
import com.iwhalecloud.byai.manager.vo.index.ManPrivVo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 数字员工索引查询服务
 *
 * @author he.duming
 * @date 2025-11-10 19:19:21
 */
@Service
public class IndexService {

    @Autowired
    private IndexMapper indexMapper;

    /**
     * 查询当前用户有权限的数字员工列表。
     *
     * @param myAuthEmployQo 查询条件
     * @return 授权数字员工列表
     */
    public List<AuthDigitEmployVo> selectAuthDigitEmploy(MyAuthEmployQo myAuthEmployQo) {
        return indexMapper.selectAuthDigitEmploy(myAuthEmployQo);
    }

    /**
     * 查询我的常用数字员工列表。 包含红名单授权且不在黑名单中的数字员工，按最新授权时间倒序排序。
     *
     * @param myUsualQo 查询条件，包含用户ID和组织ID列表
     * @return 常用数字员工列表
     */
    public List<AuthDigitEmployVo> queryMyUsual(MyUsualQo myUsualQo) {
        return indexMapper.queryMyUsual(myUsualQo);
    }

    /**
     * 查询最近新增的数字员工列表。 包含红名单授权且不在黑名单中的数字员工，按最新授权时间和创建时间倒序排序。
     *
     * @param recentlyAddedQo 查询条件，包含用户ID和组织ID列表
     * @return 最近新增的数字员工列表
     */
    public List<AuthDigitEmployVo> queryRecentlyAdded(RecentlyAddedQo recentlyAddedQo) {
        return indexMapper.queryRecentlyAdded(recentlyAddedQo);
    }

    /**
     * 查询指定用户创建且已上架的数字员工。
     *
     * @param myCreatedQo 查询条件，包含用户ID
     * @return 数字员工列表
     */
    public List<DigitEmployMarketVo> queryMyCreated(MyCreatedQo myCreatedQo) {
        return indexMapper.queryMyCreated(myCreatedQo);
    }

    /**
     * 查询数字员工发现页列表。
     *
     * @param discoverQo 发现页查询条件
     * @return 数字员工列表
     */
    public List<DigitEmployMarketExtVo> discover(DiscoverQo discoverQo) {
        return indexMapper.discover(discoverQo);
    }

    /**
     * 查询顶级组织ID列表。 获取所有父组织ID为-1的组织，即系统顶级组织。
     *
     * @return 顶级组织ID列表
     */
    public List<Long> findTopOrgId() {
        return indexMapper.findTopOrgId();
    }

    /**
     * 查询资源管理用户
     *
     * @param resourceIds 资源标识
     * @return List<ManPrivVo>
     */
    public Map<Long, List<ManPrivVo>> findManPrivVo(Collection<Long> resourceIds) {

        if (ListUtil.isEmpty(resourceIds)) {
            return Collections.emptyMap();
        }

        List<ManPrivVo> manPrivVoList = indexMapper.findManPrivVo(resourceIds);

        // 将授权对象封装成map集合返回
        Map<Long, List<ManPrivVo>> manPrivVoMap = new HashMap<>(manPrivVoList.size());
        for (ManPrivVo manPrivVo : manPrivVoList) {
            Long grantObjId = manPrivVo.getGrantObjId();
            List<ManPrivVo> manPrivVos = manPrivVoMap.computeIfAbsent(grantObjId, k -> new ArrayList<>(10));
            manPrivVos.add(manPrivVo);
        }

        return manPrivVoMap;
    }

    /**
     * 查询授权的文档
     *
     * @param authResourceQo 查询对象
     * @return ResponseUtil
     */
    public PageInfo<AuthResourceVo> queryAuthDoc(AuthResourceQo authResourceQo) {
        Page<AuthResourceVo> page = PageHelper.startPage(authResourceQo.getPageNum(), authResourceQo.getPageSize());
        indexMapper.queryAuthDoc(authResourceQo);
        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 查询默认的技能标识
     * 
     * @param authResourceQo 查询对象
     * @return List<AuthResourceVo>
     */
    public List<AuthResourceVo> queryAuthTools(AuthResourceQo authResourceQo) {
        return indexMapper.queryAuthTools(authResourceQo);
    }

}
