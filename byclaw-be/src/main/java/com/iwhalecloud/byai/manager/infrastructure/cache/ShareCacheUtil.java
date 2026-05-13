package com.iwhalecloud.byai.manager.infrastructure.cache;

import java.util.List;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.login.bean.UserStation;
import com.iwhalecloud.byai.manager.vo.users.UsersOrganizationVo;
import com.iwhalecloud.byai.common.constants.Constants;

/**
 * @author he.duming
 * @date 2025-05-12 10:19:41
 * @description redis共享信息
 */
public final class ShareCacheUtil {

    private ShareCacheUtil() {
    }

    /**
     * 从缓存中读取用户信息
     *
     * @param userId 用户标识
     * @return shareBfmUser
     */
    public static ShareBfmUser getShareBfmUser(Long userId) {
        String key = Constants.SHARE_BFM_USER + userId;
        String shareBfmUser = RedisUtil.getString(key);
        if (shareBfmUser != null) {
            return JSONObject.parseObject(shareBfmUser, ShareBfmUser.class);
        }
        else {
            return new ShareBfmUser();
        }
    }

    /**
     * 获取有户信息
     * 
     * @param userCode 用户编码
     * @return ShareBfmUser
     */
    public static ShareBfmUser getShareBfmUser(String userCode) {
        String userId = RedisUtil.getString(Constants.SHARE_BFM_USER_CODE + userCode);
        if (StringUtil.isNotEmpty(userId)) {
            return getShareBfmUser(Long.parseLong(userId));
        }
        return new ShareBfmUser();
    }

    /**
     * 从缓存中查询组织信息
     *
     * @param orgId 组织标识
     * @return Organization
     */
    public static Organization getShareOrganization(Long orgId) {

        String key = Constants.SHARE_ORGANIZATION + orgId;

        String shareOrganization = RedisUtil.getString(key);

        if (StringUtil.isNotEmpty(shareOrganization)) {
            return JSONObject.parseObject(shareOrganization, Organization.class);
        }

        return null;
    }

    /**
     * 从缓存中查询岗位信息
     *
     * @param positionId 组织标识
     * @return Organization
     */
    public static Position getSharePosition(Long positionId) {

        String key = Constants.SHARE_POSITION + positionId;

        String sharePosition = RedisUtil.getString(key);

        if (StringUtil.isNotEmpty(sharePosition)) {
            return JSONObject.parseObject(sharePosition, Position.class);
        }

        return null;
    }

    /**
     * 驻地信息写入缓存中
     *
     * @param stationId 驻地标识
     */
    public static UserStation getShareStation(Long stationId) {

        String key = Constants.SHARE_STATION + stationId;

        String shareStation = RedisUtil.getString(key);

        if (StringUtil.isNotEmpty(shareStation)) {
            return JSONObject.parseObject(shareStation, UserStation.class);
        }

        return null;
    }

    /**
     * 用户数据写入企业信息
     * 
     * @param user 用户标识
     * @param enterpriseId 企业标识
     */
    public static void setShareShareBfmUser(Users user, Long enterpriseId) {

        RedisUtil.setString(Constants.SHARE_BFM_USER_CODE + user.getUserCode(), String.valueOf(user.getUserId()));
        // 配置userId
        ShareBfmUser shareBfmUser = new ShareBfmUser();
        shareBfmUser.setUserId(user.getUserId());
        shareBfmUser.setUserCode(user.getUserCode());
        shareBfmUser.setUserName(user.getUserName());
        shareBfmUser.setPwd(user.getPwd());
        shareBfmUser.setPhone(user.getPhone());
        shareBfmUser.setComAcctId(enterpriseId);
        shareBfmUser.setStationId(user.getStationId());
        shareBfmUser.setSourceSystem("byaiManager");

        RedisUtil.setString(Constants.SHARE_BFM_USER + shareBfmUser.getUserId(), JSON.toJSONString(shareBfmUser));
    }

    /**
     * 设置用户关联组织信息
     *
     * @param usersOrganizationVos 用户关联组织信息
     */
    public static void setUsersOrganizationVos(Long userId, List<UsersOrganizationVo> usersOrganizationVos) {
        String key = Constants.SHARE_USER_ORG_POST + userId;
        RedisUtil.setString(key, JSON.toJSONString(usersOrganizationVos));
    }

    /**
     * 组织数据写入redis缓存
     *
     * @param organization 组织
     */
    public static void setShareOrganization(Organization organization) {
        String key = Constants.SHARE_ORGANIZATION + organization.getOrgId();
        RedisUtil.setString(key, JSON.toJSONString(organization));
    }

    /**
     * 岗位信息写入缓存中
     *
     * @param position 岗位信息
     */
    public static void setSharePosition(Position position) {
        String key = Constants.SHARE_POSITION + position.getPositionId();
        RedisUtil.setString(key, JSON.toJSONString(position));
    }

    /**
     * 驻地信息写入缓存中
     *
     * @param station 驻地信息
     */
    public static void setShareStation(Station station) {
        String key = Constants.SHARE_STATION + station.getStationId();
        RedisUtil.setString(key, JSON.toJSONString(station));
    }

}
