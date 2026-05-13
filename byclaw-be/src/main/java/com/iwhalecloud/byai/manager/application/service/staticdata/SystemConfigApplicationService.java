package com.iwhalecloud.byai.manager.application.service.staticdata;

import java.util.List;
import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.qo.staticdata.SystemConfigQo;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.staticdata.SystemConfigVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;

/**
 * 系统配置应用服务
 */
@Service
public class SystemConfigApplicationService {

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private SystemConfigService systemConfigService;

    /**
     * 分页查询
     *
     * @param systemConfigQo 分页查询
     * @return PageInfo
     */
    public PageInfo<SystemConfigVo> selectSystemConfigByQo(SystemConfigQo systemConfigQo) {
        PageInfo<SystemConfigVo> pageVO = systemConfigService.selectSystemConfigByQo(systemConfigQo);
        // 查询缓存数据返回
        List<SystemConfigVo> rows = pageVO.getList();
        for (int i = 0; rows != null && i < rows.size(); i++) {
            SystemConfigVo systemConfigVo = rows.get(i);
            String paramCode = systemConfigVo.getParamCode();
            String cacheJson = RedisUtil.hmGet(RedisConfig.SYSTEM_CONFIG_CODE_KEY, paramCode);
            systemConfigVo.setCacheJson(cacheJson);
        }
        return pageVO;
    }

    /**
     * 新增系统配置 该方法用于新增系统配置参数： 1. 校验参数编码是否已存在 2. 保存配置到数据库 3. 清除相关缓存
     *
     * @param byaiSystemConfig 新增请求
     * @return ByaiSystemConfig
     */
    public ByaiSystemConfig saveSystemConfig(ByaiSystemConfig byaiSystemConfig) {

        // 校验参数编码是否已存在
        long total = systemConfigService.countSystemConfig(byaiSystemConfig.getParamCode(), null);
        if (total > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "system.config.paramcode.exists.save");
        }

        byaiSystemConfig.setParamId(SequenceService.nextVal());
        systemConfigService.save(byaiSystemConfig);

        // 放缓存
        String paramCode = byaiSystemConfig.getParamCode();
        RedisUtil.hmPut(RedisConfig.SYSTEM_CONFIG_CODE_KEY, paramCode, JSON.toJSONString(byaiSystemConfig));

        return byaiSystemConfig;
    }

    /**
     * 更新系统配置 该方法用于更新系统配置参数： 1. 校验配置是否存在 2. 更新配置到数据库 3. 清除相关缓存
     *
     * @param byaiSystemConfig 更新请求
     */
    public void updateSystemConfig(ByaiSystemConfig byaiSystemConfig) {

        // 校验参数编码是否已存在
        Long paramId = byaiSystemConfig.getParamId();
        String paramCode = byaiSystemConfig.getParamCode();

        long total = systemConfigService.countSystemConfig(paramCode, paramId);
        if (total > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "system.config.paramcode.exists.update");
        }

        systemConfigService.updateById(byaiSystemConfig);

        // 放缓存
        RedisUtil.hmPut(RedisConfig.SYSTEM_CONFIG_CODE_KEY, paramCode, JSON.toJSONString(byaiSystemConfig));

    }

    /**
     * 删除系统配置 该方法用于删除系统配置参数： 1. 校验配置是否存在 2. 删除配置 3. 清除相关缓存
     *
     * @param paramId 删除请求
     */
    public void deleteSystemConfigById(Long paramId) {

        ByaiSystemConfig byaiSystemConfig = systemConfigService.findById(paramId);

        // 删除缓存
        RedisUtil.hmDelete(RedisConfig.SYSTEM_CONFIG_CODE_KEY, byaiSystemConfig.getParamCode());

        systemConfigService.deleteById(byaiSystemConfig.getParamId());
    }

    /**
     * 根据ID查询系统配置 该方法用于根据参数ID查询系统配置参数
     *
     * @param paramId 参数ID
     * @return ByaiSystemConfig
     */
    public ByaiSystemConfig getSystemConfigById(Long paramId) {
        return systemConfigService.findById(paramId);
    }

    /**
     * 清除配置缓存成功
     *
     * @param paramId 缓存标识
     */
    public void clearOneSystemConfigCache(Long paramId) {

        ByaiSystemConfig byaiSystemConfig = systemConfigService.findById(paramId);

        if (byaiSystemConfig == null || StringUtil.isEmpty(byaiSystemConfig.getParamCode())) {
            return;
        }

        String paramCode = byaiSystemConfig.getParamCode();
        String cacheJson = JSON.toJSONString(byaiSystemConfig);
        RedisUtil.hmPut(RedisConfig.SYSTEM_CONFIG_CODE_KEY, paramCode, cacheJson);
    }

    /**
     * 清除全部配置缓存成功
     */
    public void loadAllSystemConfigCache() {
        List<ByaiSystemConfig> all = systemConfigService.findAll();
        for (ByaiSystemConfig byaiSystemConfig : all) {
            String paramCode = byaiSystemConfig.getParamCode();
            String cacheJson = JSON.toJSONString(byaiSystemConfig);
            RedisUtil.hmPut(RedisConfig.SYSTEM_CONFIG_CODE_KEY, paramCode, cacheJson);
        }
    }
}
