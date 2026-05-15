package com.iwhalecloud.byai.manager.domain.auth.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.CollectionUtils;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantToObjType;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.auth.enums.OperType;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import com.iwhalecloud.byai.manager.vo.auth.DigitalEmployeeAuthVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.dto.auth.ManOrgDTO;
import com.iwhalecloud.byai.manager.dto.openapi.PrivilegeQueryDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.auth.AuthManQo;
import com.iwhalecloud.byai.manager.qo.auth.OwnAuthQo;
import com.iwhalecloud.byai.manager.qo.auth.PrivilegeGrantQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceAuthQo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceMemberItemVo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.auth.GrantObjType;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.login.bean.UserManageOrg;
import com.iwhalecloud.byai.manager.vo.auth.ManPrivDto;
import com.iwhalecloud.byai.manager.vo.auth.PrivilegeGrantAuditVo;
import com.iwhalecloud.byai.manager.vo.auth.PrivilegeGrantVo;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-04-24 18:15:21
 * @description TODO
 */
@Service
public class PrivilegeGrantService {

    public static final Logger logger = LoggerFactory.getLogger(PrivilegeGrantService.class);

    @Autowired
    private PrivilegeGrantMapper privilegeGrantMapper;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    /**
     * 保存权限
     *
     * @param privilegeGrant 权限操作
     */
    public void save(PrivilegeGrant privilegeGrant) {
        privilegeGrant.setPrivilegeGrantId(SequenceService.nextVal());
        privilegeGrant.setCreateDate(new Date());
        privilegeGrant.setEffDate(new Date());
        privilegeGrant.setCreateStaff(CurrentUserHolder.getCurrentUserId());
        privilegeGrantMapper.insert(privilegeGrant);
    }

    /**
     * 移除权限
     *
     * @param privilegeGrant 权限信息
     */
    public void remove(PrivilegeGrant privilegeGrant) {
        privilegeGrant.setStatusCd("X");
        privilegeGrant.setUpdateStaff(CurrentUserHolder.getCurrentUserId());
        privilegeGrant.setUpdateDate(new Date());
        privilegeGrantMapper.updateById(privilegeGrant);
    }

    /**
     * 更新权限信息
     *
     * @param privilegeGrant 权限信息
     */
    public void update(PrivilegeGrant privilegeGrant) {
        privilegeGrant.setUpdateStaff(CurrentUserHolder.getCurrentUserId());
        privilegeGrant.setUpdateDate(new Date());
        privilegeGrantMapper.updateById(privilegeGrant);
    }

    /**
     * 查询授权信息
     *
     * @param grantType 使用范围 AVAILABLE_USE:使用授权,FORCE_USE：强制使�?ALLOW_MANAGE:管理授权
     * @param grantObjType 资源类型,AGENT:智能�?DOC:文档�?DB:数据�?PLUGIN:插件,TOOL:工具,CATLOGUE:文档库目�?TAG:标签
     * @param grantObjId 授权资源标识
     * @param color 红名单或者黑名单
     * @return List
     */
    public List<PrivilegeGrant> findPrivilegeGrant(String grantType, String grantObjType, Long grantObjId,
        String color) {
        return privilegeGrantMapper.findPrivilegeGrant(grantType, grantObjType, grantObjId, color);
    }

    /**
     * 查询授权管理资源标识
     *
     * @return List
     */
    public List<Long> findAllowManagePrivilegeGrant(List<String> grantObjTypes) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        List<Long> allowManagePrivilegeGrant = privilegeGrantMapper.findAllowManagePrivilegeGrant(userId,
            grantObjTypes);
        if (ListUtil.isNotEmpty(allowManagePrivilegeGrant)) {
            return allowManagePrivilegeGrant;
        }
        // 防止智能体报错resourceIdList不能为空�?
        return List.of(Long.MIN_VALUE);
    }

    /**
     * @param privilegeGrantQo 权限查询
     * @return PrivilegeGrant
     */
    public List<PrivilegeGrant> findPrivilegeByQo(PrivilegeGrantQo privilegeGrantQo) {
        return privilegeGrantMapper.findPrivilegeByQo(privilegeGrantQo);
    }

    /**
     * @param privilegeGrantQo 权限查询
     * @return PrivilegeGrant
     */
    public List<PrivilegeGrantVo> findPrivilegeGrantByCondition(PrivilegeGrantQo privilegeGrantQo) {
        return privilegeGrantMapper.findPrivilegeGrantByCondition(privilegeGrantQo);
    }

    /**
     * chatbi数据权限
     *
     * @param authManQo 授权信息
     * @return ManOrgDTO
     */
    public List<ManOrgDTO> listMangerOrgUseDetail(AuthManQo authManQo) {
        return privilegeGrantMapper.listMangerOrgUseDetail(authManQo);
    }

    /***
     * @param userId 用户标识
     * @return List
     */
    public List<UserManageOrg> findUserManageOrg(Long userId) {
        return privilegeGrantMapper.findUserManageOrg(userId);
    }

    /**
     * 查询所有权�?
     *
     * @return PrivilegeGrant
     */
    public List<PrivilegeGrant> selectList() {
        LambdaQueryWrapper<PrivilegeGrant> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PrivilegeGrant::getStatusCd, "A");
        queryWrapper.in(PrivilegeGrant::getGrantType, GrantType.AVAILABLE_USE, GrantType.ALLOW_MANAGE);
        queryWrapper.in(PrivilegeGrant::getGrantObjType, GrantObjType.AGENT, GrantObjType.DIG_EMPLOYEE,
            GrantObjType.MCP, GrantObjType.KG_DOC, GrantObjType.KG_DB, GrantObjType.TOOLKIT, GrantObjType.TOOL);
        return privilegeGrantMapper.selectList(queryWrapper);
    }

    public void removePriv(PrivilegeGrant priviledgeGrant) {
        SsResource ssResource = ssResourceMapper.selectById(priviledgeGrant.getGrantObjId());
        // 1.首先查看是否存在，个人权�?
        LambdaQueryWrapper<PrivilegeGrant> wrapper = new LambdaQueryWrapper<>();
        // 权限
        wrapper.eq(PrivilegeGrant::getGrantType, priviledgeGrant.getGrantType());
        wrapper.eq(PrivilegeGrant::getGrantObjType, ssResource.getResourceBizType());
        // resource_id
        wrapper.eq(PrivilegeGrant::getGrantObjId, priviledgeGrant.getGrantObjId());
        wrapper.eq(PrivilegeGrant::getGrantToType, Color.RED);
        // 2.有的就修改状态为x,写入redis中；
        List<PrivilegeGrant> privilegeGrants = privilegeGrantMapper.selectList(wrapper);
        int isGrantedToOther = 0;
        // 如果没有红名单，但是有权限，那应该是redis的问�?
        if (CollectionUtils.isNotEmpty(privilegeGrants)) {
            for (PrivilegeGrant privilegeGrant : privilegeGrants) {
                // 判断是否授权给了自己--只会有一条给自己�?
                if (GrantToObjType.USER.equals(privilegeGrant.getGrantToObjType())
                    && CurrentUserHolder.getCurrentUserId().equals(privilegeGrant.getGrantToObjId())) {
                    updatePriviledgeStatus(privilegeGrant, ssResource);
                }
                if (GrantToObjType.ORG.equals(privilegeGrant.getGrantToObjType())
                    || GrantToObjType.POST.equals(privilegeGrant.getGrantToObjType())
                    || GrantToObjType.STATION.equals(privilegeGrant.getGrantToObjType())) {
                    // 写入一条黑名单
                    isGrantedToOther++;
                }
            }
            if (isGrantedToOther > 0) {
                addBlackPriviledge(ssResource);
            }

        }

    }

    public void removeAllByGrantObj(String grantObjType, Long grantObjId) {
        if (StringUtils.isBlank(grantObjType) || grantObjId == null) {
            return;
        }
        LambdaQueryWrapper<PrivilegeGrant> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PrivilegeGrant::getGrantObjType, grantObjType)
            .eq(PrivilegeGrant::getGrantObjId, grantObjId);
        privilegeGrantMapper.delete(wrapper);
    }

    private void updatePriviledgeStatus(PrivilegeGrant privilegeGrant, SsResource ssResource) {

        privilegeGrant.setStatusCd("X");
        privilegeGrantMapper.updateById(privilegeGrant);
        String key = "DATASET:AUTHORITY:1_RED_READ_PERSON_" + privilegeGrant.getGrantToObjId();
        String value = ssResource.getResourceBizType() + "_" + ssResource.getResourceId();
        RedisUtil.removeSet(key, value);

    }

    private void addBlackPriviledge(SsResource ssResource) {
        PrivilegeGrant blackPriv = new PrivilegeGrant();
        blackPriv.setGrantType(GrantType.AVAILABLE_USE);
        blackPriv.setGrantObjType(ssResource.getResourceBizType());
        blackPriv.setGrantObjId(ssResource.getResourceId());
        blackPriv.setGrantToObjId(CurrentUserHolder.getCurrentUserId());
        blackPriv.setGrantToObjType(GrantToObjType.USER);
        blackPriv.setGrantToType(Color.BLACK);
        blackPriv.setOperType(OperType.READ);
        blackPriv.setStatusCd("A");
        blackPriv.setPrivilegeGrantId(SequenceService.nextVal());
        blackPriv.setCreateDate(new Date());
        privilegeGrantMapper.insert(blackPriv);
        // 2.还要redis中插入一条黑名单数据
        String key = "DATASET:AUTHORITY:1_BLACK_READ_PERSON_" + blackPriv.getGrantToObjId();
        String value = ssResource.getResourceBizType() + "_" + ssResource.getResourceId();
        RedisUtil.addSet(key, value);
    }

    /**
     * 授权资源或数据员工授权id
     *
     * @param authQo 查询对象
     */
    public List<Long> listOwnResourceOrEmployee(OwnAuthQo authQo) {
        return privilegeGrantMapper.listOwnResourceOrEmployee(authQo);
    }

    /**
     * 查询列表
     *
     * @param privilegeQueryDTO 查询条件
     */
    public List<PrivilegeGrantAuditVo> findPrivilegeGrantAuditVo(PrivilegeQueryDTO privilegeQueryDTO) {
        return privilegeGrantMapper.findPrivilegeGrantAuditVo(privilegeQueryDTO);
    }

    public List<Long> getAllAdminUserIds(Long resourceId) {
        return privilegeGrantMapper.getAllAdminUserIds(resourceId);
    }

    public List<PrivilegeGrant> getAllowManagePrivList(SsResource ssResource, String[] manUserIds) {
        // 查找已经授权�?
        LambdaQueryWrapper<PrivilegeGrant> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PrivilegeGrant::getGrantObjId, ssResource.getResourceId());
        wrapper.eq(PrivilegeGrant::getGrantType, GrantType.ALLOW_MANAGE);
        wrapper.eq(PrivilegeGrant::getStatusCd, "A");
        wrapper.eq(PrivilegeGrant::getOperType, OperType.READ);
        wrapper.eq(PrivilegeGrant::getGrantToType, Color.RED);
        wrapper.eq(PrivilegeGrant::getGrantObjType, ssResource.getResourceBizType());
        wrapper.eq(PrivilegeGrant::getGrantToObjType, GrantToObjType.USER);
        wrapper.in(PrivilegeGrant::getGrantToObjId, Arrays.asList(manUserIds));
        List<PrivilegeGrant> list = privilegeGrantMapper.selectList(wrapper);
        return list.isEmpty() ? null : list;
    }

    /**
     * 查询资源成员授权明细。
     */
    public List<ResourceMemberItemVo> queryResourceMembers(Long resourceId, String resourceBizType,
        List<String> grantTypes) {
        if (resourceId == null || org.springframework.util.CollectionUtils.isEmpty(grantTypes)) {
            return Collections.emptyList();
        }
        return privilegeGrantMapper.queryResourceMembers(resourceId, resourceBizType, grantTypes);
    }

    public List<ManPrivDto> queryAllManPrivInfo(List<Long> resourceIds) {
        return privilegeGrantMapper.queryAllManPrivInfo(resourceIds);
    }

    public Map<Long, Map<String, String>> queryManPrivMap(List<Long> resourceIds) {
        List<ManPrivDto> manPrivDtos = queryAllManPrivInfo(resourceIds);
        return convertManPrivDtosToMap(manPrivDtos);
    }

    public Map<Long, Map<String, String>> convertManPrivDtosToMap(List<ManPrivDto> manPrivDtos) {
        // 使用Stream API直接构建结果
        Map<Long, Set<Long>> grantToObjIdMap = manPrivDtos.stream()
            .filter(dto -> dto.getGrantObjId() != null && dto.getGrantToObjId() != null).collect(Collectors.groupingBy(
                ManPrivDto::getGrantObjId, Collectors.mapping(ManPrivDto::getGrantToObjId, Collectors.toSet())));

        Map<Long, Set<String>> userNameMap = manPrivDtos.stream()
            .filter(dto -> dto.getGrantObjId() != null && dto.getGrantToObjId() != null)
            .collect(Collectors.groupingBy(ManPrivDto::getGrantObjId,
                Collectors.mapping(dto -> dto.getUserName() != null ? dto.getUserName() : "", Collectors.toSet())));

        // 合并结果
        Set<Long> allKeys = new HashSet<>();
        allKeys.addAll(grantToObjIdMap.keySet());
        allKeys.addAll(userNameMap.keySet());

        return allKeys.stream().collect(Collectors.toMap(key -> key, key -> {
            Map<String, String> valueMap = new HashMap<>();
            valueMap.put("grantToObjIds", grantToObjIdMap.getOrDefault(key, Collections.emptySet()).stream()
                .map(String::valueOf).collect(Collectors.joining(",")));
            valueMap.put("userNames", String.join(",", userNameMap.getOrDefault(key, Collections.emptySet())));
            return valueMap;
        }));
    }

    public boolean hasForePriv(Long resourceId) {
        LambdaQueryWrapper<PrivilegeGrant> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PrivilegeGrant::getGrantObjId, resourceId);
        wrapper.eq(PrivilegeGrant::getGrantType, GrantType.FORCE_USE);
        wrapper.eq(PrivilegeGrant::getStatusCd, "A");
        return privilegeGrantMapper.selectCount(wrapper) > 0;
    }

    /**
     * 查询指定资源下仍生效的红名单授权行（用于数字员工元数据变更后按授权对象展开用户并刷新权限缓存）。
     */
    public List<PrivilegeGrant> listActiveRedGrantsForGrantObject(Long grantObjId, String grantObjType) {
        if (grantObjId == null || grantObjType == null) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<PrivilegeGrant> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PrivilegeGrant::getGrantObjId, grantObjId);
        wrapper.eq(PrivilegeGrant::getGrantObjType, grantObjType);
        wrapper.eq(PrivilegeGrant::getGrantToType, Color.RED);
        wrapper.eq(PrivilegeGrant::getStatusCd, "A");
        return privilegeGrantMapper.selectList(wrapper);
    }

    /**
     * 查询授权资源
     *
     * @param resourceUseAuthQo 查询对象
     * @return PageInfo
     */
    public PageInfo<ResourceAuthVo> listResourceAuth(ResourceUseAuthQo resourceUseAuthQo) {

        Integer pageNum = resourceUseAuthQo.getPageNum();
        Integer pageSize = resourceUseAuthQo.getPageSize();
        Page<ResourceAuthVo> page = PageHelper.startPage(pageNum, pageSize);

        privilegeGrantMapper.listResourceAuth(resourceUseAuthQo);

        return PageHelperUtil.toPageInfo(page);
    }

    public AuthRedBlackDTO buildPriv(SsResource ssResource, String grantType) {
        AuthRedBlackDTO authRedBlackDTO = new AuthRedBlackDTO();
        authRedBlackDTO.setGrantObjId(ssResource.getResourceId());
        authRedBlackDTO.setGrantType(grantType);
        authRedBlackDTO.setGrantObjType(ssResource.getResourceBizType());
        authRedBlackDTO.setSourceSystem(ssResource.getSystemCode());
        switch (grantType) {
            case GrantType.OWNER:
                createOwnPriv(ssResource, authRedBlackDTO);
                break;
            case GrantType.AVAILABLE_USE:
            case GrantType.FORCE_USE:
            case GrantType.SHARE_USE:
                createCurrentUserPriv(authRedBlackDTO);
                break;
            case GrantType.ALLOW_MANAGE:
                createManagerPriv(ssResource, authRedBlackDTO);
                break;
            default:
                break;
        }

        return authRedBlackDTO;
    }

    private void createManagerPriv(SsResource ssResource, AuthRedBlackDTO authRedBlackDTO) {
        // 设置用户�?
        List<AuthDTO> redList = new ArrayList<>();

        // 处理多个manUserId（用逗号分隔�?
        String manUserIds = ssResource.getManUserId();
        if (manUserIds != null && !manUserIds.trim().isEmpty()) {
            String[] userIdArray = manUserIds.split(",");
            for (String userIdStr : userIdArray) {
                if (userIdStr.trim().isEmpty()) {
                    continue;
                }
                try {
                    Long userId = Long.parseLong(userIdStr.trim());
                    AuthDTO userAuth = new AuthDTO();
                    userAuth.setGrantToObjId(userId);
                    userAuth.setGrantToObjType(GrantToObjType.USER);
                    redList.add(userAuth);
                }
                catch (Exception e) {
                    logger.error(e.getMessage(), e);
                }
            }
        }

        authRedBlackDTO.setRedList(redList);
    }

    private void createOwnPriv(SsResource ssResource, AuthRedBlackDTO authRedBlackDTO) {
        List<AuthDTO> redList = new ArrayList<>();
        AuthDTO orgAuth = new AuthDTO();
        orgAuth.setGrantToObjId(ssResource.getManOrgId());
        orgAuth.setGrantToObjType(GrantToObjType.ORG);
        redList.add(orgAuth);
        authRedBlackDTO.setRedList(redList);
    }

    private void createCurrentUserPriv(AuthRedBlackDTO authRedBlackDTO) {
        List<AuthDTO> redList = new ArrayList<>();
        AuthDTO userAuth = new AuthDTO();
        // 设置当前用户的的
        userAuth.setGrantToObjId(CurrentUserHolder.getCurrentUserId());
        userAuth.setGrantToObjType(GrantToObjType.USER);
        redList.add(userAuth);
        authRedBlackDTO.setRedList(redList);
    }

    /**
     * 查询有权限资源
     *
     * @param resourceAuthQo 查询对象
     * @return PageInfo
     */
    public PageInfo<ResourceAuthVo> listResource(ResourceAuthQo resourceAuthQo) {
        Page<ResourceAuthVo> page = PageHelper.startPage(resourceAuthQo.getPageNum(), resourceAuthQo.getPageSize());
        privilegeGrantMapper.listResource(resourceAuthQo);
        return PageHelperUtil.toPageInfo(page);
    }

    public PageInfo<DigitalEmployeeAuthVo> listDigitalEmployeeAuthByUser(AuthQo authQo) {
        Page<DigitalEmployeeAuthVo> page = PageHelper.startPage(authQo.getPageNum(), authQo.getPageSize());
        privilegeGrantMapper.listDigitalEmployeeAuthByUser(authQo);
        return PageHelperUtil.toPageInfo(page);
    }
}
