package com.iwhalecloud.byai.manager.application.service.user;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import com.iwhalecloud.byai.manager.application.service.login.AppleLoginService;
import org.apache.commons.collections4.CollectionUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.application.service.user.base.BaseUserApplicationService;
import com.iwhalecloud.byai.manager.domain.event.user.UsersDeletedEvent;
import com.iwhalecloud.byai.manager.domain.event.user.UsersUpdatedEvent;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.station.service.StationService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationService;
import com.iwhalecloud.byai.manager.dto.position.PositionDTO;
import com.iwhalecloud.byai.manager.dto.users.BatchDelUserDTO;
import com.iwhalecloud.byai.manager.dto.users.DelUserDTO;
import com.iwhalecloud.byai.manager.dto.users.ResetPasswordDTO;
import com.iwhalecloud.byai.manager.dto.users.UpdatePasswordDTO;
import com.iwhalecloud.byai.manager.dto.users.UsersDTO;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.manager.qo.users.SearchUserQo;
import com.iwhalecloud.byai.manager.qo.users.UsersByOrgIdQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.constants.users.IsLocked;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.ecrypt.MD5Utils;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.login.bean.CasTicketUser;
import com.iwhalecloud.byai.manager.vo.users.UsersDetailVo;
import com.iwhalecloud.byai.manager.vo.users.UsersOrgVo;
import com.iwhalecloud.byai.common.constants.Constants;
import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;

/**
 * 用户应用服务
 */

@Service
public class UserApplicationService extends BaseUserApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(UserApplicationService.class);

    @Autowired
    private UsersMapper usersMapper;

    @Autowired
    private UserService userService;

    @Autowired
    private StationService stationService;

    @Autowired
    private OrganizationService organizationService;

    @Autowired
    private ApplicationEventPublisher eventPublisher;

    @Autowired
    private UsersOrganizationService usersOrganizationService;

    @Autowired
    private SuasSuperassistService suasSuperassistService;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private UserBucketProvisioningService userBucketProvisioningService;

    /**
     * 新增用户
     *
     * @param usersDTO 入参
     * @return ResponseUtil
     */

    public ResponseUtil addUser(UsersDTO usersDTO) {

        List<String> userTypeList = getUserTypeListAndValidate(usersDTO);

        // 判断是否为组织管理员或者平台管理员

        if (!(CurrentUserHolder.isPlatformManager()

            || organizationService.isOrganizationManManager(usersDTO.getOrgId()))) {

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));

        }

        // 平台管理角色权限判断

        if (userTypeList.stream().anyMatch(UserType.PLAT_MAN::equalsIgnoreCase)
            && !CurrentUserHolder.isPlatformManager()) {

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,

                I18nUtil.get("user.platformadmin.add.nopermission"));

        }

        // 保存用户

        Users users = new Users();

        BeanUtils.copyProperties(usersDTO, users);

        users.setPwd(MD5Utils.encrypt(super.getDefaultPwd(), users.getUserCode()));
        userService.addUser(users);

        // 创建用户关组织岗位信息

        List<UsersOrganization> usersOrganizations = new ArrayList<>(3);

        userTypeList.forEach(userType -> {

            UsersOrganization usersOrganization = new UsersOrganization();

            usersOrganization.setUserId(users.getUserId());

            usersOrganization.setOrgId(usersDTO.getOrgId());

            usersOrganization.setUserType(userType);

            usersOrganization.setPositionId(usersDTO.getPositionId());

            usersOrganizations.add(usersOrganization);

        });

        usersOrganizationService.saveBatch(usersOrganizations);

        // 保存用户后的操作

        this.saveUserAfter(users, usersOrganizations);

        /**
         * 用户创建成功后，初始化默认 MinIO 桶，失败只记日志，不影响管理员新增用户主流程。
         * add by qin.guoquan 2026-04-17
         */
        logger.info("管理员新增用户成功，开始初始化默认MinIO桶, userId={}, userCode={}", users.getUserId(), users.getUserCode());
        userBucketProvisioningService.ensureUserBucketQuietly(users.getUserCode());

        return ResponseUtil.successResponse(users.getUserId());

    }

    /**
     * 获取用户类型列表并验证
     *
     * @param usersDTO 入参
     * @return List<String> 用户类型列表
     */

    public List<String> getUserTypeListAndValidate(UsersDTO usersDTO) {

        // 1. 多选不为空 �?直接返回 userTypes

        if (CollUtil.isNotEmpty(usersDTO.getUserTypes())) {

            return usersDTO.getUserTypes();

        }

        // 2. 单选不为空 �?转成单元素列表

        else if (StrUtil.isNotBlank(usersDTO.getUserType())) {

            return Collections.singletonList(usersDTO.getUserType());

        }

        else {

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.usertype.notempty"));

        }

    }

    /**
     * 更新用户
     *
     * @param usersDTO 入参
     * @return ResponseUtil
     */

    public ResponseUtil updateUser(UsersDTO usersDTO) {

        List<String> userTypeList = getUserTypeListAndValidate(usersDTO);

        // 判断是否为组织管理员或者平台管理员

        if (!(CurrentUserHolder.isPlatformManager()

            || organizationService.isOrganizationManManager(usersDTO.getOrgId()))) {

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));

        }

        Long userId = usersDTO.getUserId();

        Map<Long, List<UsersOrganization>> usersOrganizationMap = usersOrganizationService.findGroupByOrgId(userId);

        List<UsersOrganization> usersOrganizations = usersOrganizationMap.remove(usersDTO.getOrgId());

        if (CollUtil.isNotEmpty(usersOrganizations)) {

            // 平台管理角色操作权限判断

            if (usersOrganizations.stream().anyMatch(uo -> UserType.PLAT_MAN.equalsIgnoreCase(uo.getUserType()))

                && !CurrentUserHolder.isPlatformManager()) {

                throw new BaseException(CommonErrorCode.ERROR_CODE_50500,

                    I18nUtil.get("user.platformadmin.update.nopermission"));

            }

            if (userTypeList.stream().anyMatch(UserType.PLAT_MAN::equalsIgnoreCase)
                && !CurrentUserHolder.isPlatformManager()) {

                throw new BaseException(CommonErrorCode.ERROR_CODE_50500,

                    I18nUtil.get("user.platformadmin.update.nopermission"));

            }

            // 删除旧关联关系

            usersOrganizationService.removeByPrimaryKeys(
                usersOrganizations.stream().map(UsersOrganization::getId).collect(Collectors.toList()));

            // 创建用户关组织岗位信息

            List<UsersOrganization> usersOrganizationList = new ArrayList<>(3);

            userTypeList.forEach(userType -> {

                UsersOrganization usersOrganization = new UsersOrganization();

                usersOrganization.setUserId(usersDTO.getUserId());

                usersOrganization.setOrgId(usersDTO.getOrgId());

                usersOrganization.setUserType(userType);

                usersOrganization.setPositionId(usersDTO.getPositionId());

                usersOrganizationList.add(usersOrganization);

            });

            usersOrganizationService.saveBatch(usersOrganizationList);

        }

        else {

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,

                I18nUtil.get("user.org.notin", usersDTO.getOrgId()));

        }

        // 把修改或者新增的关联关系添加到集合中

        usersOrganizationMap.put(usersDTO.getOrgId(), usersOrganizations);

        // 查询用户

        Users users = userService.findById(usersDTO.getUserId());

        if (users == null) {

            return ResponseUtil.fail(I18nUtil.get("user.update.not.exist"));

        }

        // 设置更新用户信息

        users.setUserName(usersDTO.getUserName());

        users.setPhone(usersDTO.getPhone());

        users.setUserCode(usersDTO.getUserCode());

        users.setEmail(usersDTO.getEmail());

        users.setRemark(usersDTO.getRemark());

        users.setUserNumber(usersDTO.getUserNumber());

        userService.updateUser(users);

        // 更新用户后操作

        super.updateUserAfter(users,
            usersOrganizationMap.values().stream().flatMap(Collection::stream).collect(Collectors.toList()));

        return ResponseUtil.success(I18nUtil.get("user.update.success"));

    }

    /**
     * 删除用户
     *
     * @param delUserDTO 用户ID
     * @return 操作结果
     */

    public ResponseUtil deleteUser(DelUserDTO delUserDTO) {

        Long userId = delUserDTO.getUserId();

        Long orgId = delUserDTO.getOrgId();

        Map<Long, List<UsersOrganization>> usersOrganizationMap = usersOrganizationService.findGroupByOrgId(userId);

        List<UsersOrganization> usersOrganizations = usersOrganizationMap.remove(orgId);

        if (CollUtil.isEmpty(usersOrganizations)) {

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.org.infoerror"));

        }

        // 判断是否为组织管理员或者平台管理员

        if (!(CurrentUserHolder.isPlatformManager() || organizationService.isOrganizationManManager(orgId))) {

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));

        }

        // 平台管理角色权限判断

        if (usersOrganizations.stream().anyMatch(uo -> UserType.PLAT_MAN.equalsIgnoreCase(uo.getUserType()))

            && !CurrentUserHolder.isPlatformManager()) {

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,

                I18nUtil.get("user.platformadmin.remove.nopermission"));

        }

        if (!usersOrganizationMap.isEmpty()) {

            // 如果当前用户有其他关联关系，不删除用户，只移除当前组织的关系

            usersOrganizationService.removeByPrimaryKeys(
                usersOrganizations.stream().map(UsersOrganization::getId).collect(Collectors.toList()));

            // 查询当前用户

            Users users = userService.findById(userId);

            // 更新用户关联组织关系

            Collection<UsersOrganization> values = usersOrganizationMap.values().stream().flatMap(Collection::stream)
                .toList();

            // 发布用户修改事件

            eventPublisher.publishEvent(new UsersUpdatedEvent(this, users, new ArrayList<>(values)));

        }

        else {

            // 移除关联

            usersOrganizationService.removeByPrimaryKeys(
                usersOrganizations.stream().map(UsersOrganization::getId).collect(Collectors.toList()));

            // 修改用户为无效

            userService.deleteUser(userId);

            // 发布用户删除事件

            eventPublisher.publishEvent(new UsersDeletedEvent(this, userId));

            // 移除超级助手

            suasSuperassistService.remove(userId);

            // 移除超级级助手目录

            ssSuperassistKwCatalogService.remove(userId);

        }

        return ResponseUtil.success(I18nUtil.get("user.leave.organization.success"));

    }

    /**
     * 查询用户
     *
     * @param searchUserQo 入参
     * @return ResponseUtil
     */

    public ResponseUtil searchUser(SearchUserQo searchUserQo) {

        UsersDetailVo usersDetailVo = usersMapper.selectUsersDetailVo(searchUserQo);

        if (CollUtil.isNotEmpty(usersDetailVo.getUserTypes())) {

            usersDetailVo.setUserType(usersDetailVo.getUserTypes().get(0));

        }

        // 解密并脱敏手机号
        usersDetailVo.setPhone(decryptAndMaskPhone(usersDetailVo.getPhone()));

        return ResponseUtil.successResponse(usersDetailVo);

    }

    /**
     * 获取组织下的所有员工
     *
     * @param usersByOrgIdQo 分页获取组织下面的所有中心
     * @return PageInfo
     */

    public PageInfo<UsersOrgVo> getUsersByOrgId(UsersByOrgIdQo usersByOrgIdQo) {

        Page<UsersOrgVo> page = new Page<>(usersByOrgIdQo.getPageNum(), usersByOrgIdQo.getPageSize());

        Long orgId = usersByOrgIdQo.getOrgId();

        Long positionId = usersByOrgIdQo.getPositionId();

        String userType = usersByOrgIdQo.getUserType();

        String keyword = usersByOrgIdQo.getKeyword();

        boolean containsChildren = usersByOrgIdQo.isContainsChildren();

        usersMapper.getUsersByOrgId(page, orgId, containsChildren, positionId, userType, keyword);

        List<UsersOrgVo> usersOrgVos = page.getRecords();

        for (UsersOrgVo usersOrgVo : usersOrgVos) {

            if (CollUtil.isNotEmpty(usersOrgVo.getUserTypes())) {

                usersOrgVo.setUserType(usersOrgVo.getUserTypes().get(0));

            }

            // 解密并脱敏手机号
            usersOrgVo.setPhone(decryptAndMaskPhone(usersOrgVo.getPhone()));

        }

        return PageHelperUtil.toPageInfo(page);

    }

    /**
     * 重置密码
     *
     * @param resetPasswordDTO 重置的用户信息
     * @return ResponseUtil
     */

    public ResponseUtil resetPassword(ResetPasswordDTO resetPasswordDTO) {

        // 非平台管理员或者组织管理员不能重置密码

        if (!(CurrentUserHolder.isPlatformManager()

            || organizationService.isOrganizationManManager(resetPasswordDTO.getOrgId()))) {

            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,

                I18nUtil.get("user.password.reset.nopermission"));

        }

        Long userId = resetPasswordDTO.getUserId();

        Users users = userService.findById(userId);

        if (users == null) {

            return ResponseUtil.fail(I18nUtil.get("user.not.exist"));

        }

        users.setPwd(MD5Utils.encrypt(this.getDefaultPwd(), users.getUserCode()));

        userService.resetPassword(users);

        return ResponseUtil.success(I18nUtil.get("user.password.reset.success"));

    }

    /**
     * 删除用户
     *
     * @param batchDelUserDTO 入参
     * @return ResponseUtil
     */

    public ResponseUtil batchDelUser(BatchDelUserDTO batchDelUserDTO) {

        List<DelUserDTO> delUserDTOList = batchDelUserDTO.getDelUserDTOList();

        for (DelUserDTO delUserDTO : delUserDTOList) {

            this.deleteUser(delUserDTO);

        }

        return ResponseUtil.success(I18nUtil.get("user.batch.leave.organization.success"));

    }

    /**
     * 查询用户简单信息
     *
     * @param params 用户标识
     * @return RequestMapping
     */

    public ResponseUtil findSimpleUsersById(Map<String, Object> params) {

        List userIds = (List) params.get("userIds");

        if (userIds == null || userIds.isEmpty()) {

            return ResponseUtil.fail(I18nUtil.get("user.employee.id.list.empty"));

        }

        List<Map<String, Object>> resultList = new ArrayList<>(10);

        for (Object userId : userIds) {

            Users users = userService.findById(Long.parseLong(String.valueOf(userId)));

            if (users == null) {

                return ResponseUtil.fail(I18nUtil.get("user.info.not.exist.id", userId));

            }

            Map<String, Object> result = new HashMap<>();

            result.put("userId", users.getUserId());

            result.put("userCode", users.getUserCode());

            result.put("userName", users.getUserName());

            // 解密并脱敏手机号
            result.put("phone", decryptAndMaskPhone(users.getPhone()));

            resultList.add(result);

        }

        return ResponseUtil.successResponse(resultList);

    }

    /**
     * 登陆后修改密码
     *
     * @param updatePasswordDTO 修改密码信息
     * @return ResponseUtil
     */

    public ResponseUtil updatePassword(UpdatePasswordDTO updatePasswordDTO) {

        Users users = userService.findById(updatePasswordDTO.getUserId());

        if (users == null) {

            return ResponseUtil.fail(I18nUtil.get("user.info.not.exist"));

        }

        // 旧密码

        String decryptOldPassword = Sm4Util.decrypt(updatePasswordDTO.getOldPassword());

        String encryptOldPassword = MD5Utils.encrypt(decryptOldPassword, users.getUserCode());

        if (!users.getPwd().equals(encryptOldPassword)) {

            return ResponseUtil.fail(I18nUtil.get("user.old.password.error"));

        }

        // 重置新密码

        String decryptNewPassword = Sm4Util.decrypt(updatePasswordDTO.getNewPassword());

        String encryptNewPassword = MD5Utils.encrypt(decryptNewPassword, users.getUserCode());

        users.setPwd(encryptNewPassword);

        userService.update(users);

        List<UsersOrganization> usersOrganizations = usersOrganizationService.findByUserId(users.getUserId());

        // 更新密码后的操作

        this.updateUserAfter(users, usersOrganizations);

        return ResponseUtil.successResponse(I18nUtil.get("user.password.modify.success"));

    }

    /**
     * 查找用户
     *
     * @param qo 查询对象
     * @return ResponseUtil
     */

    public PageInfo<Map<String, Object>> findUserSuas(QueryObject qo) {

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

            List<PositionDTO> positions = positionService.findPositionByUserId(user.getUserId());

            // 查询超级助手ID

            SuasSuperassist superassist = suasSuperassistService.findByUserId(user.getUserId());

            Long superassistId = superassist != null ? superassist.getSuperassistId() : null;

            Map<String, Object> row = new HashMap<>(6);

            row.put("userId", user.getUserId());

            row.put("userName", user.getUserName());

            row.put("userCode", user.getUserCode());

            row.put("positionName", positions.get(0).getPositionName());

            row.put("pathName", pathName);

            row.put("superassistId", superassistId);

            // 避免空指针异常，检查superassist是否为空
            row.put("avatar", superassist != null ? superassist.getAvatar() : null);

            row.put("suasIntro", superassist != null ? superassist.getIntro() : null);

            row.put("suasName", superassist != null ? superassist.getName() : null);

            // 解密并脱敏手机号
            row.put("phone", decryptAndMaskPhone(user.getPhone()));

            row.put("chattedTimes", getChattedNumber(user.getUserId()));

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
     * 获取用户信息
     *
     * @param userId
     * @return ResponseUtil
     */

    public ResponseUtil getUserSuas(Long userId) {

        Users user = userService.findById(userId);

        if (user == null) {

            return ResponseUtil.fail("用户不存在");

        }

        List<UsersOrganization> usersOrganizations = usersOrganizationService.findByUserId(userId);

        List<Long> orgIds = usersOrganizations.stream().map(UsersOrganization::getOrgId).collect(Collectors.toList());

        String pathName = organizationService.buildPathNameByOrgIds(orgIds);

        List<PositionDTO> positions = positionService.findPositionByUserId(userId);

        SuasSuperassist superassist = suasSuperassistService.findByUserId(userId);

        Map<String, Object> result = new HashMap<>(6);

        result.put("userId", user.getUserId());

        result.put("userName", user.getUserName());

        result.put("userCode", user.getUserCode());

        result.put("email", user.getEmail());

        if (Objects.nonNull(user.getStationId())) {

            Station station = stationService.getById(user.getStationId());

            result.put("stationName", station.getStationName());

        }

        if (CollectionUtils.isNotEmpty(positions)) {

            PositionDTO firstPosition = positions.get(0);

            if (firstPosition != null) {

                result.put("headerName", firstPosition.getHeaderName());

                result.put("positionName", positions.get(0).getPositionName());

            }

        }

        result.put("pathName", pathName);

        result.put("superassistId", superassist.getSuperassistId());

        result.put("avatar", superassist.getAvatar());

        result.put("suasIntro", superassist.getIntro());

        result.put("suasName", superassist.getName());

        result.put("prologue", superassist.getPrologue());

        result.put("chattedTimes", getChattedNumber(user.getUserId()));

        // 解密并脱敏手机号
        result.put("phone", decryptAndMaskPhone(user.getPhone()));

        return ResponseUtil.successResponse(result);

    }

    // 被聊过次数接口的空实现

    public Long getChattedNumber(Long userId) {

        return 66L;

    }

    /**
     * 查询员工基本信息
     *
     * @param qo 查询
     * @return ResponseUtil
     */

    public PageInfo<Map<String, Object>> listUser(QueryObject qo) {

        String keyword = qo.getKeyword();

        LambdaQueryWrapper<Users> queryWrapper = new LambdaQueryWrapper<>();

        queryWrapper.eq(Users::getState, UserState.ACTIVE);

        if (StringUtil.isNotEmpty(keyword)) {

            queryWrapper.and(w -> w.like(Users::getUserName, keyword).or().like(Users::getUserCode, keyword));

        }

        Page<Users> page = new Page<>(qo.getPageNum(), qo.getPageSize(), true);

        List<Users> users = userService.selectList(page, queryWrapper);

        List<Map<String, Object>> rows = new ArrayList<>(10);

        for (Users user : users) {

            Map<String, Object> rowMap = new HashMap<>(5);

            rowMap.put("userId", user.getUserId());

            rowMap.put("userCode", user.getUserCode());

            rowMap.put("userName", user.getUserName());

            rowMap.put("email", user.getEmail());

            // 解密并脱敏手机号
            rowMap.put("phone", decryptAndMaskPhone(user.getPhone()));

            rows.add(rowMap);

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
     * 手机号码注册用户
     *
     * @param phone 手机号码
     * @return Users
     */

    public Users registerByPhone(String phone) {

        Users users = new Users();

        users.setUserId(SequenceService.nextVal());

        users.setUserCode(phone);

        users.setUserName(this.maskPhone(phone));

        users.setUserNumber(phone);

        users.setPwd(MD5Utils.encrypt(this.getDefaultPwd(), users.getUserCode()));

        users.setPhone(phone);

        users.setIsLocked(IsLocked.NO);

        users.setAssistantId(users.getUserId());

        users.setUserEffDate(new Date());

        users.setRegisterType(1);

        userService.save(users);

        this.saveUserAfter(users, Collections.emptyList());

        userBucketProvisioningService.ensureUserBucketQuietly(users.getUserCode());

        return users;

    }

    /** Base62 字符集：0-9、A-Z、a-z，用于编码 */
    private static final String BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    /**
     * 为苹果ID登录用户生成唯一的用户编码（8-12位大小写字母+数字）。结合苹果 userId（唯一不重复）与时间戳，无需查库即可保证不重复。
     *
     * @param appleUserInfo 苹果用户信息，其 userId 在苹果体系内唯一
     * @return 基于苹果 userId 与时间戳的唯一用户编码
     */

    public static String generateUniqueUserCodeForIos(AppleLoginService.AppleUserInfo appleUserInfo) {

        long ts = System.currentTimeMillis();

        String appleUserId = (appleUserInfo != null && appleUserInfo.getUserId() != null) ? appleUserInfo.getUserId()
            : "";

        long userIdHash = 0L;

        for (int i = 0; i < appleUserId.length(); i++) {

            userIdHash = userIdHash * 31 + appleUserId.charAt(i);

        }

        userIdHash = userIdHash & 0x7FFFFFFFFFFFFFFFL;

        long value = ts * 10000 + (userIdHash % 10000);

        StringBuilder sb = new StringBuilder(12);

        do {

            sb.append(BASE62_CHARS.charAt((int) (value % 62)));

            value /= 62;

        }
        while (value > 0);

        String code = sb.reverse().toString();

        if (code.length() < 8) {

            code = String.format("%8s", code).replace(' ', '0');

        }

        return code.length() > 12 ? code.substring(0, 12) : code;

    }

    /**
     * ios app 手机号码注册用户
     *
     * @param phone 手机号码
     * @return Users
     */

    public Users registerIosByPhone(String phone, AppleLoginService.AppleUserInfo appleUserInfo) {

        phone = Sm4Util.encrypt(phone);

        Users users = new Users();

        users.setUserId(SequenceService.nextVal());

        users.setUserCode(generateUniqueUserCodeForIos(appleUserInfo));

        users.setUserName(appleUserInfo.getUserName());

        users.setPwd(MD5Utils.encrypt(this.getDefaultPwd(), users.getUserCode()));

        users.setPhone(phone);

        users.setIsLocked(IsLocked.NO);

        users.setAssistantId(users.getUserId());

        users.setUserEffDate(new Date());

        users.setRegisterType(3);

        users.setAppleUserId(appleUserInfo.getUserId());

        users.setEmail(appleUserInfo.getEmail());

        userService.save(users);

        this.saveUserAfter(users, Collections.emptyList());

        userBucketProvisioningService.ensureUserBucketQuietly(users.getUserCode());

        return users;

    }

    /**
     * 脱敏手机号
     *
     * @param phone 手机号码
     * @return String
     */

    public static String maskPhone(String phone) {

        // 校验手机号格式

        if (StrUtil.isBlank(phone)) {

            return I18nUtil.get("phone.format.invalid");

        }

        // 提取纯数字部分

        String digitsOnly = phone.replaceAll("[^0-9]", "");

        // 如果没有数字，返回原值

        if (StrUtil.isBlank(digitsOnly)) {

            return phone;

        }

        // 根据数字长度确定脱敏策略

        String maskedDigits;

        int digitLength = digitsOnly.length();

        if (digitLength >= 11) {

            // 超长号码（如国际号码）：保留前3位和后4位，中间用*替代

            int starsCount = digitLength - 7; // 3 + 4 = 7, 剩下的用*

            String stars = "*".repeat(starsCount);

            maskedDigits = digitsOnly.substring(0, 3) + stars + digitsOnly.substring(digitLength - 4);

        }
        else if (digitLength >= 7) {

            // 标准手机号码：保留前3位和后4位，中间用*替代

            int starsCount = digitLength - 7; // 3 + 4 = 7, 剩下的用*

            String stars = "*".repeat(starsCount);

            maskedDigits = digitsOnly.substring(0, 3) + stars + digitsOnly.substring(digitLength - 4);

        }
        else if (digitLength >= 4) {

            // 中等长度号码：保留前2位和后2位，中间用*替代

            int starsCount = digitLength - 4; // 2 + 2 = 4, 剩下的用*

            String stars = "*".repeat(starsCount);

            maskedDigits = digitsOnly.substring(0, 2) + stars + digitsOnly.substring(digitLength - 2);

        }
        else if (digitLength >= 2) {

            // 短号码：保留前1位和后1位，中间用*替代

            int starsCount = digitLength - 2; // 1 + 1 = 2, 剩下的用*

            String stars = "*".repeat(starsCount);

            maskedDigits = digitsOnly.substring(0, 1) + stars + digitsOnly.substring(digitLength - 1);

        }
        else {

            // 超短号码：返回原值

            return phone;

        }

        // 如果原始号码只包含数字，直接返回脱敏后的数字

        if (phone.equals(digitsOnly)) {

            return maskedDigits;

        }

        // 保持原始格式：将脱敏后的数字按原始分隔符位置重新组装

        return reconstructPhoneWithOriginalFormat(phone, digitsOnly, maskedDigits);

    }

    /**
     * 按原始格式重新组装电话号码
     *
     * @param originalPhone 原始电话号码
     * @param originalDigits 原始纯数字部分
     * @param maskedDigits 脱敏后的纯数字部分
     * @return 保持原始格式的脱敏电话号码
     */

    private static String reconstructPhoneWithOriginalFormat(String originalPhone, String originalDigits,
        String maskedDigits) {

        // 如果长度不匹配，返回脱敏后的纯数字

        if (originalDigits.length() != maskedDigits.length()) {

            return maskedDigits;

        }

        StringBuilder result = new StringBuilder();

        int digitIndex = 0;

        // 遍历原始字符串，按位置替换数字

        for (char c : originalPhone.toCharArray()) {

            if (Character.isDigit(c)) {

                // 是数字，用脱敏后的对应数字替换

                if (digitIndex < maskedDigits.length()) {

                    result.append(maskedDigits.charAt(digitIndex));

                    digitIndex++;

                }

            }
            else {

                // 不是数字，保持原字符

                result.append(c);

            }

        }

        return result.toString();

    }

    /**
     * 注销用户
     */

    public void inactiveUser() {

        Long userId = CurrentUserHolder.getCurrentUserId();

        Users users = userService.findById(userId);

        users.setState(UserState.DISABLED);

        userService.update(users);

    }

    /**
     * 注册cas登陆用户
     *
     * @param casTicketUser cas用户信息
     * @return Users
     */

    public Users registerByCasTicketUser(CasTicketUser casTicketUser) {

        Users users = new Users();

        users.setUserId(SequenceService.nextVal());

        users.setUserCode(casTicketUser.getUserName());

        users.setUserName(casTicketUser.getUserName());

        users.setUserNumber(casTicketUser.getUserName());

        users.setPwd(MD5Utils.encrypt(this.getDefaultPwd(), users.getUserCode()));

        users.setIsLocked(IsLocked.NO);

        users.setAssistantId(users.getUserId());

        users.setUserEffDate(new Date());

        userService.save(users);

        this.saveUserAfter(users, Collections.emptyList());

        userBucketProvisioningService.ensureUserBucketQuietly(users.getUserCode());

        return users;

    }

    /**
     * 检查用户是否是默认密码
     *
     * @param users 用户标识
     * @return Boolean
     */

    public Boolean checkDefaultPwd(Users users) {

        // 是否开启检查是否为默认密码的逻辑,例外adminvip

        String checkDefaultPwd = systemConfigService.getStringParamValueByCode("CHECK_DEFAULT_PWD");

        if (Constants.NO_VALUE_FALSE.equals(checkDefaultPwd) || "adminvip".equalsIgnoreCase(users.getUserCode())) {

            return false;

        }

        String encryptDefaultPwd = MD5Utils.encrypt(this.getDefaultPwd(), users.getUserCode());

        return encryptDefaultPwd != null && encryptDefaultPwd.equals(users.getPwd());

    }

    /**
     * 解密并脱敏手机号 解密phone后脱敏5个字符内容
     *
     * @param encryptedPhone 加密的手机号
     * @return 脱敏后的手机号
     */
    public static String decryptAndMaskPhone(String encryptedPhone) {
        if (StrUtil.isBlank(encryptedPhone)) {
            return encryptedPhone;
        }

        try {
            // 使用SM4解密
            String decryptedPhone = Sm4Util.decrypt(encryptedPhone);
            if (StrUtil.isBlank(decryptedPhone)) {
                return encryptedPhone;
            }

            // 脱敏处理：保留前3位和后2位，中间用*号替代，总共脱敏5个字符
            return maskPhone(decryptedPhone);
        }
        catch (Exception e) {
            // 解密失败时返回原值
            logger.error("手机号解密失败: " + e.getMessage(), e);
            return encryptedPhone;
        }
    }

    /**
     * 对单个用户的phone进行解密后重新加密，若成功则加入待更新列表
     *
     * @param user 用户
     * @param usersToUpdate 待更新用户列表（会被修改）
     * @return 若该用户需要更新返回1，否则返回0
     */
    private int reencryptUserPhoneIfNeeded(Users user, List<Users> usersToUpdate) {
        String originalPhone = user.getPhone();
        if (StrUtil.isBlank(originalPhone)) {
            logger.debug("用户 {} phone为空，跳过处理", user.getUserId());
            return 0;
        }
        try {
            String decryptedPhone = originalPhone;
            try {
                decryptedPhone = Sm4Util.decrypt(originalPhone);
            }
            catch (Exception e) {
                logger.debug("用户 {} phone解密，跳过处理", user.getUserId());
            }
            if (StrUtil.isNotBlank(decryptedPhone)) {
                String reEncryptedPhone = Sm4Util.encrypt(decryptedPhone);
                user.setPhone(reEncryptedPhone);
                usersToUpdate.add(user);
                logger.debug("用户 {} phone重新加密成功", user.getUserId());
                return 1;
            }
            logger.debug("用户 {} phone格式无效，跳过处理: {}", user.getUserId(), decryptedPhone);
            return 0;
        }
        catch (Exception e) {
            logger.warn("用户 " + user.getUserId() + " phone解密失败，跳过处理: " + e.getMessage());
            return 0;
        }
    }

    /**
     * 批量更新用户信息（处理phone属性加密） 查询用户总数，按每100条分页处理，每个用户的phone属性进行解密验证后重新加密
     *
     * @return ResponseUtil 处理结果
     */
    public ResponseUtil batchUpdateUserPhones() {
        logger.info("开始批量更新用户信息phone属性");

        try {
            // 查询用户总数（只统计有效用户）
            LambdaQueryWrapper<Users> countWrapper = new LambdaQueryWrapper<>();
            countWrapper.eq(Users::getState, UserState.ACTIVE);
            Long totalUsers = usersMapper.selectCount(countWrapper);
            logger.info("用户总数: {}", totalUsers);

            if (totalUsers == 0) {
                return ResponseUtil.success(I18nUtil.get("user.batch.update.no.data"));
            }

            int pageSize = 100;
            long totalPages = (totalUsers + pageSize - 1) / pageSize; // 计算总页数

            int totalProcessed = 0;
            int totalUpdated = 0;

            // 分页处理，每页100条
            for (long pageIndex = 1; pageIndex <= totalPages; pageIndex++) {
                Page<Users> page = new Page<>(pageIndex, pageSize);
                LambdaQueryWrapper<Users> queryWrapper = new LambdaQueryWrapper<>();
                queryWrapper.eq(Users::getState, UserState.ACTIVE);
                List<Users> usersList = userService.selectList(page, queryWrapper);

                if (CollectionUtils.isEmpty(usersList)) {
                    continue;
                }

                List<Users> usersToUpdate = new ArrayList<>();
                int processedInPage = usersList.size();
                int updatedInPage = 0;

                for (Users user : usersList) {
                    updatedInPage += reencryptUserPhoneIfNeeded(user, usersToUpdate);
                }

                if (!usersToUpdate.isEmpty()) {
                    int updateCount = usersMapper.batchUpdateUsers(usersToUpdate);
                    logger.info("第{}页处理完成，本页处理{}条，更新{}条，实际更新{}条", pageIndex, processedInPage, updatedInPage,
                        updateCount);
                }
                else {
                    logger.info("第{}页处理完成，本页处理{}条，无需更新", pageIndex, processedInPage);
                }

                totalProcessed += processedInPage;
                totalUpdated += updatedInPage;
            }

            logger.info("批量更新用户信息phone属性完成，总处理{}条，更新{}条", totalProcessed, totalUpdated);
            return ResponseUtil.success(I18nUtil.get("user.batch.update.success", totalProcessed, totalUpdated));

        }
        catch (Exception e) {
            logger.error("批量更新用户信息phone属性失败: " + e.getMessage(), e);
            throw new BaseException(CommonErrorCode.ERROR_CODE_50400,
                I18nUtil.get("user.batch.update.fail", e.getMessage()), e);
        }
    }

}
