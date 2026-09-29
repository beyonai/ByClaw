package com.iwhalecloud.byai.manager.mapper.system;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.system.SysAppVersion;
import org.apache.ibatis.annotations.Param;

/**
 * 应用版本信息Mapper
 */

public interface SysAppVersionMapper extends BaseMapper<SysAppVersion> {

    /**
     * 根据设备类型查询最新版本信息
     *
     * @param deviceType 设备类型
     * @param platform 平台，为空时不参与过滤
     * @param arch 架构，为空时不参与过滤
     * @param channel 渠道，为空时不参与过滤
     * @return 最新版本信息
     */
    SysAppVersion selectLatestVersionByDeviceType(@Param("deviceType") String deviceType,
        @Param("platform") String platform, @Param("arch") String arch, @Param("channel") String channel);
}