package com.iwhalecloud.byai.state.common.share.helper;

import java.util.List;

import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.login.bean.UserStation;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import org.apache.commons.lang3.StringUtils;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.state.common.share.bean.Organization;

/**
 * @author he.duming
 * @date 2025-05-12 10:19:41
 * @description redis共享信息
 */
public final class ShareCacheUtil {

    /**
     * redis中存储的用户Id
     */
    public static final String SHARE_BFM_USER = "SHARE_BFM_USER_";

    /**
     * redis中存储的用户编码
     */
    public static final String SHARE_BFM_USER_CODE = "SHARE_BFM_USER_CODE_";

    /**
     * redis中存储的用户编码
     */
    public static final String SHARE_ORGANIZATION = "SHARE_ORGANIZATION_";

    /**
     * redis中存储的岗位信息
     */
    public static final String SHARE_POSITION = "SHARE_POSITION_";

    /**
     * redis中存储的驻地标识
     */
    public static final String SHARE_STATION = "SHARE_STATION_";

    /**
     * redis中存储的用户编码对应的组织列表信息
     */
    public static final String SHARE_USER_ORG_POST = "SHARE_USER_ORG_POST_";

    private ShareCacheUtil() {
    }

    /**
     * 从缓存中读取用户信息
     *
     * @param userId 用户标识
     * @return shareBfmUser
     */
    public static ShareBfmUser getShareBfmUser(Long userId) {
        String key = SHARE_BFM_USER + userId;
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
        String userId = RedisUtil.getString(SHARE_BFM_USER_CODE + userCode);
        if (StringUtils.isNotEmpty(userId)) {
            return getShareBfmUser(Long.parseLong(userId));
        }
        return new ShareBfmUser();
    }

    /**
     * 从缓存中查询组织信息
     *
     * @param userId 组织标识
     * @return Organization
     */
    public static List<UsersOrganization> getShareOrganizationRelUser(Long userId) {

        String key = SHARE_USER_ORG_POST + userId;

        String shareOrganization = RedisUtil.getString(key);

        if (StringUtils.isNotEmpty(shareOrganization)) {
            return JSONObject.parseArray(shareOrganization, UsersOrganization.class);
        }

        return null;
    }

    /**
     * 从缓存中查询组织信息
     *
     * @param orgId 组织标识
     * @return Organization
     */
    public static Organization getShareOrganization(Long orgId) {

        String key = SHARE_ORGANIZATION + orgId;

        String shareOrganization = RedisUtil.getString(key);

        if (StringUtils.isNotEmpty(shareOrganization)) {
            return JSONObject.parseObject(shareOrganization, Organization.class);
        }

        return null;
    }

    /**
     * 驻地信息写入缓存中
     *
     * @param stationId 驻地标识
     */
    public static UserStation getShareStation(Long stationId) {

        String key = SHARE_STATION + stationId;

        String shareStation = RedisUtil.getString(key);

        if (StringUtils.isNotEmpty(shareStation)) {
            return JSONObject.parseObject(shareStation, UserStation.class);
        }

        return null;
    }

}
