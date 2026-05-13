package com.iwhalecloud.byai.manager.domain.resource.service;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDigEmployeeMapper;
import com.iwhalecloud.byai.manager.qo.resource.DigEmployeeExtQo;
import com.iwhalecloud.byai.manager.qo.resource.DigitalEmployeeQo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeePageVo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeeVo;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.state.common.share.helper.ShareCacheUtil;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-10-09 17:59:48
 * @description TODO
 */
@Service
public class SsResExtDigEmployeeService {

    @Autowired
    private SsResExtDigEmployeeMapper ssResExtDigEmployeeMapper;

    /**
     * 分页查询
     *
     * @param digitalEmployeeQo 查询对象
     * @return PageInfo
     */
    public PageInfo<DigitalEmployeePageVo> selectDigitalEmployeeByQo(DigitalEmployeeQo digitalEmployeeQo) {

        int pageNum = digitalEmployeeQo.getPageNum();
        int pageSize = digitalEmployeeQo.getPageSize();
        Page<DigitalEmployeePageVo> page = PageHelper.startPage(pageNum, pageSize);

        ssResExtDigEmployeeMapper.selectDigitalEmployeeByQo(digitalEmployeeQo);

        PageInfo<DigitalEmployeePageVo> pageInfo = PageHelperUtil.toPageInfo(page);
        List<DigitalEmployeePageVo> list = pageInfo.getList();
        for (DigitalEmployeePageVo digitalEmployeePageVo : list) {
            String manUserId = digitalEmployeePageVo.getManUserId();
            if (StringUtil.isEmpty(manUserId)) {
                continue;
            }
            String[] split = manUserId.split(",");
            List<String> resultList = new ArrayList<>();
            for (String userId : split) {
                ShareBfmUser shareBfmUser = ShareCacheUtil.getShareBfmUser(Long.parseLong(userId));
                resultList.add(shareBfmUser.getUserName());
            }
            digitalEmployeePageVo.setManUserName(StringUtils.join(resultList, ","));
        }

        return pageInfo;

    }

    /**
     * 无权限上下文的分页查询。 给“查询全部有效数字员工”这类通用场景使用，不注入当前登录人的 owner / authorize / manager 权限条件。
     */
    public PageInfo<DigitalEmployeeVo> selectAllDigitalEmployeeByQo(DigitalEmployeeQo digitalEmployeeQo) {
        int pageNum = digitalEmployeeQo.getPageNum();
        int pageSize = digitalEmployeeQo.getPageSize();
        Page<DigitalEmployeeVo> page = PageHelper.startPage(pageNum, pageSize);

        ssResExtDigEmployeeMapper.selectDigitalEmployeeByQo(digitalEmployeeQo);

        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 查询 owner_type = personal 的数字员工列表。 查询范围覆盖： 1. 我创建的； 2. 我管理的； 3. 我使用的。
     */
    public PageInfo<DigitalEmployeeVo> selectPersonalDigitalEmployeeByQo(DigitalEmployeeQo digitalEmployeeQo) {
        int pageNum = digitalEmployeeQo.getPageNum();
        int pageSize = digitalEmployeeQo.getPageSize();
        Page<DigitalEmployeeVo> page = PageHelper.startPage(pageNum, pageSize);

        ssResExtDigEmployeeMapper.selectPersonalDigitalEmployeeByQo(digitalEmployeeQo);

        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 查询资源详情
     *
     * @param resourceId 资源信息
     */
    public DigitalEmployeeDetailsDTO findDetailsById(Long resourceId) {
        return ssResExtDigEmployeeMapper.findDetailsById(resourceId);
    }

    /**
     * 插入数字员工体扩展表
     *
     * @param ssResExtDigEmployee 数字员工体扩展
     */
    public void save(SsResExtDigEmployee ssResExtDigEmployee) {
        ssResExtDigEmployeeMapper.insert(ssResExtDigEmployee);
    }

    /**
     * 更新数字员工体扩展表
     *
     * @param ssResExtDigEmployee 数字员工体扩展
     */
    public void update(SsResExtDigEmployee ssResExtDigEmployee) {
        ssResExtDigEmployeeMapper.updateById(ssResExtDigEmployee);
    }

    /**
     * 查询资源信息
     *
     * @param resourceId 资源扩展标识
     */
    public SsResExtDigEmployee findById(Long resourceId) {
        return ssResExtDigEmployeeMapper.selectById(resourceId);
    }

    /**
     * 查询数字员工信息
     *
     * @param resourceIds 资源标识
     * @return List<ResourceExtDigEmployeeDto>
     */
    public List<ResourceExtDigEmployeeDto> findExtDigEmployeeByIds(Collection<Long> resourceIds) {
        return ssResExtDigEmployeeMapper.findExtDigEmployeeByIds(resourceIds);
    }

    /**
     * 查询数字员工信息
     *
     * @param resourceId 资源标识
     * @return ResourceExtDigEmployeeDto
     */
    public ResourceExtDigEmployeeDto findExtDigEmployeeById(Long resourceId) {
        List<Long> resourceIds = Collections.singletonList(resourceId);
        List<ResourceExtDigEmployeeDto> resourceExtDigEmployeeDtos = this.findExtDigEmployeeByIds(resourceIds);
        return resourceExtDigEmployeeDtos.isEmpty() ? null : resourceExtDigEmployeeDtos.get(0);
    }

    /**
     * 查询所有已上架的数字员工信息
     *
     * @return 数字员工扩展信息列表
     */
    public List<ResourceExtDigEmployeeDto> findOnlineDigitalEmployees() {
        return this.findOnlineDigitalEmployees(null);
    }

    /**
     * 按机器渠道查询所有已上架的数字员工信息
     *
     * @param machineChannel 机器渠道，可空
     * @return 数字员工扩展信息列表
     */
    public List<ResourceExtDigEmployeeDto> findOnlineDigitalEmployees(String machineChannel) {
        return ssResExtDigEmployeeMapper.findOnlineResourceExtDigEmployees(machineChannel);
    }

    /**
     * 删除数字员工
     *
     * @param resourceId 资源标识
     */
    public void removeById(Long resourceId) {
        ssResExtDigEmployeeMapper.deleteById(resourceId);
    }

    /**
     * 查询数字员工信息，包括扩展信息
     *
     * @param digEmployeeExtQo 查询对象
     * @return ResourceExtDigEmployeeDto
     */
    public ResourceExtDigEmployeeDto findExtDigEmployeeByQo(DigEmployeeExtQo digEmployeeExtQo) {
        return ssResExtDigEmployeeMapper.findExtDigEmployeeByQo(digEmployeeExtQo);
    }
}
