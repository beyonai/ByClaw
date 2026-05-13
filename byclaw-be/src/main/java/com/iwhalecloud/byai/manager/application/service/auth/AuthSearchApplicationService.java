package com.iwhalecloud.byai.manager.application.service.auth;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.domain.station.service.StationService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationService;
import com.iwhalecloud.byai.manager.dto.openapi.UserOrganizationDTO;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * @author he.duming
 * @date 2025-05-28 15:34:15
 * @description TODO
 */
@Service
public class AuthSearchApplicationService {

    @Autowired
    private UserService userService;

    @Autowired
    private PositionService positionService;

    @Autowired
    private OrganizationService organizationService;

    @Autowired
    private UsersOrganizationService usersOrganizationService;

    @Autowired
    private StationService stationService;

    /**
     * 综合搜索
     *
     * @param qo 关键字搜�?
     * @return ResponseUtil
     */
    public ResponseUtil findAll(QueryObject qo) {

//        qo.setPageNum(1);
//        qo.setPageSize(10L);

        PageInfo<Map<String, Object>> orgPageVO = this.findOrg(qo);
        PageInfo<Map<String, Object>> userPageVO = this.findUser(qo);
        PageInfo<Position> positionPageVO = this.findPosition(qo);
        PageInfo<Station> stationPageVO = this.findStation(qo);

        Map<String, Object> resultMap = new HashMap<>(5);
        resultMap.put("orgList", orgPageVO.getList());
        resultMap.put("userList", userPageVO.getList());
        resultMap.put("positionList", positionPageVO.getList());
        resultMap.put("stationList", stationPageVO.getList());
        return ResponseUtil.successResponse(resultMap);
    }

    /**
     * 高级查找组织
     *
     * @param qo 分页搜索组织信息
     * @return ResponseUtil
     */
    public PageInfo<Map<String, Object>> findOrg(QueryObject qo) {

        String keyword = qo.getKeyword();
        LambdaQueryWrapper<Organization> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.like(Organization::getOrgName, keyword);
        Page<Organization> page = new Page<>(qo.getPageNum(), qo.getPageSize(), true);
        List<Organization> organizations = organizationService.selectList(page, queryWrapper);

        List<Map<String, Object>> rows = new ArrayList<>(10);
        for (Organization organization : organizations) {
            Map<String, Object> row = new HashMap<>(5);
            row.put("orgId", organization.getOrgId());
            row.put("orgName", organization.getOrgName());
            row.put("pathName", organizationService.buildPathNameByOrgIds(List.of(organization.getOrgId())));
            rows.add(row);
        }

        PageInfo<Map<String, Object>> pageInfo = new PageInfo<>();
        pageInfo.setList(rows);
        pageInfo.setTotal(page.getTotal());
        pageInfo.setTotalPages((int) page.getPages());
        pageInfo.setPageNum((int) page.getCurrent());
        pageInfo.setPageSize((int) page.getSize());
        return pageInfo;
    }

    /**
     * 查找用户
     *
     * @param qo 查询对象
     * @return ResponseUtil
     */
    public PageInfo<Map<String, Object>> findUser(QueryObject qo) {

        String keyword = qo.getKeyword();

        LambdaQueryWrapper<Users> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Users::getState, UserState.ACTIVE)
            .and(w -> w.like(Users::getUserName, keyword).or().like(Users::getUserCode, keyword));
        Page<Users> page = new Page<>(qo.getPageNum(), qo.getPageSize(), true);

        List<Users> users = userService.selectList(page, queryWrapper);

        List<Map<String, Object>> rows = new ArrayList<>(10);
        for (Users user : users) {

            List<UsersOrganization> usersOrganizations = usersOrganizationService.findByUserId(user.getUserId());
            List<Long> orgIds = usersOrganizations.stream().map(UsersOrganization::getOrgId)
                .collect(Collectors.toList());
            String pathName = organizationService.buildPathNameByOrgIds(orgIds);

            Map<String, Object> row = new HashMap<>(5);
            row.put("userId", user.getUserId());
            row.put("userName", user.getUserName());
            row.put("userCode", user.getUserCode());
            row.put("pathName", pathName);
            rows.add(row);
        }

        PageInfo<Map<String, Object>> pageInfo = new PageInfo<>();
        pageInfo.setList(rows);
        pageInfo.setTotal(page.getTotal());
        pageInfo.setTotalPages((int) page.getPages());
        pageInfo.setPageNum((int) page.getCurrent());
        pageInfo.setPageSize((int) page.getSize());
        return pageInfo;
    }

    /**
     * 高级查找岗位
     *
     * @param qo 分页搜索组织信息
     * @return ResponseUtil
     */
    public PageInfo<Position> findPosition(QueryObject qo) {

        String keyword = qo.getKeyword();

        LambdaQueryWrapper<Position> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.like(Position::getPositionName, keyword);

        Page<Position> page = new Page<>(qo.getPageNum(), qo.getPageSize(), true);
        List<Position> positions = positionService.selectList(page, queryWrapper);
        page.setRecords(positions);
        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 高级查找驻地
     *
     * @param qo 分页搜索驻地信息
     * @return PageInfo&lt;Station&gt;
     */
    public PageInfo<Station> findStation(QueryObject qo) {
        String keyword = qo.getKeyword();
        LambdaQueryWrapper<Station> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.like(Station::getStationName, keyword);
        Page<Station> page = new Page<>(qo.getPageNum(), qo.getPageSize(), true);
        List<Station> stations = stationService.selectList(page, queryWrapper);
        page.setRecords(stations);
        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 根据用户ID列表获取组织信息（高性能优化版本�?
     *
     * @param userIds 用户ID列表
     * @return ResponseUtil 包含用户组织信息的响�?
     */
    public ResponseUtil findUserOrganizationsByUserIds(List<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return ResponseUtil.successResponse(new ArrayList<>());
        }

        // 第一步：获取所有用户对应的组织信息
        List<UsersOrganization> allUserOrgs = usersOrganizationService.findByUserIds(userIds);

        // 第二步：获取所有组织ID
        List<Long> allOrgIds = allUserOrgs.stream()
            .map(UsersOrganization::getOrgId)
            .collect(Collectors.toList());

        // 第三步：使用高性能的批量查询，一次性获取所有组织信息（包括路径名称�?
        List<Map<String, Object>> orgInfoList = organizationService.findOrganizationsWithPathNames(new ArrayList<>(allOrgIds));

        // 第四步：按用户分组，一个用户一条记录，多个组织用空格分�?
        Map<Long, List<UsersOrganization>> userOrgMap = allUserOrgs.stream()
            .collect(Collectors.groupingBy(UsersOrganization::getUserId));
        
        List<UserOrganizationDTO> resultList = new ArrayList<>();
        
        for (Long userId : userIds) {
            List<UsersOrganization> userOrgs = userOrgMap.get(userId);
            if (userOrgs != null && !userOrgs.isEmpty()) {
                // 收集该用户的所有组织信�?
                List<String> pathCodes = new ArrayList<>();
                List<String> pathNames = new ArrayList<>();
                
                for (UsersOrganization userOrg : userOrgs) {
                    Map<String, Object> orgInfo = orgInfoList.stream()
                        .filter(org -> userOrg.getOrgId().equals(org.get("orgId")))
                        .findFirst()
                        .orElse(new HashMap<>());
                    
                    if (orgInfo.containsKey("pathCode")) {
                        pathCodes.add(String.valueOf(orgInfo.get("pathCode")));
                    }
                    if (orgInfo.containsKey("pathName")) {
                        pathNames.add(String.valueOf(orgInfo.get("pathName")));
                    }
                }
                
                // 构建用户记录
                UserOrganizationDTO userRecord = new UserOrganizationDTO(
                    userId,
                    String.join(" ", pathCodes),
                    String.join(" ", pathNames)
                );
                resultList.add(userRecord);
            }
            else {
                // 用户没有组织，也要返回记�?
                UserOrganizationDTO userRecord = new UserOrganizationDTO(userId, "", "");
                resultList.add(userRecord);
            }
        }

        return ResponseUtil.successResponse(resultList);
    }
}
