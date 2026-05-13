package com.iwhalecloud.byai.manager.interfaces.controller.staticdata;

import com.iwhalecloud.byai.manager.application.service.staticdata.SystemConfigApplicationService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.iwhalecloud.byai.manager.qo.staticdata.SystemConfigQo;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.staticdata.SystemConfigVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * @author he.duming
 * @date 2026-01-08 09:58:21
 * @description 静态配置的增删改查
 */
@RestController
@RequestMapping("/system/systemConfigController")
public class SystemConfigController {

    @Autowired
    private SystemConfigApplicationService systemConfigApplicationService;

    /**
     * 分页查询
     *
     * @param systemConfigQo 分页查询
     * @return ResponseUtil
     */
    @RequestMapping(value = "/selectSystemConfigByQo", method = RequestMethod.POST)
    public ResponseUtil<PageInfo<SystemConfigVo>> selectSystemConfigByQo(@RequestBody SystemConfigQo systemConfigQo) {
        PageInfo<SystemConfigVo> pageVO = systemConfigApplicationService.selectSystemConfigByQo(systemConfigQo);
        return ResponseUtil.success(pageVO);
    }

    /**
     * 根据ID查询系统配置
     *
     * @param paramId 查询请求参数
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getSystemConfigById", method = RequestMethod.GET)
    public ResponseUtil<ByaiSystemConfig> getSystemConfigById(
        @RequestParam(value = "paramId", required = true) Long paramId) {
        ByaiSystemConfig byaiSystemConfig = systemConfigApplicationService.getSystemConfigById(paramId);
        return ResponseUtil.successResponse(I18nUtil.get("system.config.query.success"), byaiSystemConfig);
    }

    /**
     * 新增系统配置
     *
     * @param byaiSystemConfig 新增请求参数
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "系统配置", description = "新增系统配置")
    @RequestMapping(value = "/saveSystemConfig", method = RequestMethod.POST)
    public ResponseUtil<ByaiSystemConfig> saveSystemConfig(
        @RequestBody @Validated(Add.class) ByaiSystemConfig byaiSystemConfig) {
        byaiSystemConfig = systemConfigApplicationService.saveSystemConfig(byaiSystemConfig);
        return ResponseUtil.successResponse(I18nUtil.get("system.config.save.success"), byaiSystemConfig);
    }

    /**
     * 更新系统配置
     *
     * @param byaiSystemConfig 更新请求参数
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "系统配置", description = "更新系统配置")
    @RequestMapping(value = "/updateSystemConfig", method = RequestMethod.POST)
    public ResponseUtil<String> updateSystemConfig(
        @RequestBody @Validated(Mod.class) ByaiSystemConfig byaiSystemConfig) {
        systemConfigApplicationService.updateSystemConfig(byaiSystemConfig);
        return ResponseUtil.success(I18nUtil.get("system.config.update.success"));
    }

    /**
     * 删除系统配置
     *
     * @param paramId 删除请求参数
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "系统配置", description = "删除系统配置")
    @RequestMapping(value = "/deleteSystemConfigById", method = RequestMethod.GET)
    public ResponseUtil<String> deleteSystemConfigById(@RequestParam(value = "paramId", required = true) Long paramId) {
        systemConfigApplicationService.deleteSystemConfigById(paramId);
        return ResponseUtil.success(I18nUtil.get("system.config.delete.success"));
    }

    /**
     * 刷新配置缓存成功
     *
     * @param paramId 缓存标识
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "系统配置", description = "刷新单个配置缓存")
    @RequestMapping(value = "/clearOneSystemConfigCache", method = RequestMethod.GET)
    public ResponseUtil<String> clearOneSystemConfigCache(
        @RequestParam(value = "paramId", required = true) Long paramId) {
        systemConfigApplicationService.clearOneSystemConfigCache(paramId);
        return ResponseUtil.success(I18nUtil.get("system.config.cache.clear.one.success"));
    }

    /**
     * 刷新全部配置缓存成功
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "系统配置", description = "刷新全部配置缓存")
    @RequestMapping(value = "/clearAllSystemConfigCache", method = RequestMethod.GET)
    public ResponseUtil<String> clearAllSystemConfigCache() {
        systemConfigApplicationService.loadAllSystemConfigCache();
        return ResponseUtil.success(I18nUtil.get("system.config.cache.clear.all.success"));
    }
}
