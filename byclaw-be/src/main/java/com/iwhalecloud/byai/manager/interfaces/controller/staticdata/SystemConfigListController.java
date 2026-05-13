package com.iwhalecloud.byai.manager.interfaces.controller.staticdata;

import com.iwhalecloud.byai.manager.application.service.staticdata.SystemConfigListApplicationService;
import com.iwhalecloud.byai.manager.dto.staticdata.SystemConfigListDTO;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.staticdata.SystemConfigListGroupVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 系统配置列表控制器
 *
 * @author system
 * @date 2025-01-XX
 */
@RestController
@RequestMapping("/system/systemConfigListController")
public class SystemConfigListController {

    @Autowired
    private SystemConfigListApplicationService systemConfigListApplicationService;

    /**
     * 分页查询
     *
     * @param qo 分页查询
     * @return ResponseUtil
     */
    @RequestMapping(value = "/selectSystemConfigListByQo", method = RequestMethod.POST)
    public ResponseUtil<PageInfo<SystemConfigListGroupVo>> selectSystemConfigListByQo(@RequestBody QueryObject qo) {
        PageInfo<SystemConfigListGroupVo> pageVO = systemConfigListApplicationService.selectSystemConfigListGroupByQo(qo);
        return ResponseUtil.success(pageVO);
    }

    /**
     * 新增系统配置列表
     *
     * @param bystemConfigListDTO 新增请求参数
     * @return ResponseUtil
     */
    @RequestMapping(value = "/saveSystemConfigList", method = RequestMethod.POST)
    @ManageLogAnnotation(name = "静态参数配置", description = "新增静态参数列表")
    public ResponseUtil<String> saveSystemConfigList(
        @RequestBody @Validated(Add.class) SystemConfigListDTO bystemConfigListDTO) {
        systemConfigListApplicationService.saveSystemConfigList(bystemConfigListDTO);
        return ResponseUtil.success(I18nUtil.get("system.config.list.save.success"));
    }

    /**
     * 更新系统配置列表
     *
     * @param bystemConfigListDTO 更新请求参数
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "静态参数配置", description = "更新静态参数列表")
    @RequestMapping(value = "/updateSystemConfigList", method = RequestMethod.POST)
    public ResponseUtil<String> updateSystemConfigList(
        @RequestBody @Validated(Mod.class) SystemConfigListDTO bystemConfigListDTO) {
        systemConfigListApplicationService.updateSystemConfigList(bystemConfigListDTO);
        return ResponseUtil.success(I18nUtil.get("system.config.list.update.success"));
    }

    /**
     * 根据分组编码删除系统配置列表
     *
     * @param paramGroupCode 分组编码
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "静态参数配置", description = "删除静态参数列表")
    @RequestMapping(value = "/deleteByParamGroupCode", method = RequestMethod.GET)
    public ResponseUtil<String> deleteByParamGroupCode(
        @RequestParam(value = "paramGroupCode", required = true) String paramGroupCode) {
        systemConfigListApplicationService.deleteByParamGroupCode(paramGroupCode);
        return ResponseUtil.success(I18nUtil.get("system.config.list.delete.success"));
    }

    /**
     * 根据分组编码查询系统配置列表
     *
     * @param paramGroupCode 分组编码
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getByParamGroupCode", method = RequestMethod.GET)
    public ResponseUtil<SystemConfigListDTO> getByParamGroupCode(
        @RequestParam(value = "paramGroupCode", required = true) String paramGroupCode) {
        SystemConfigListDTO systemConfigListDTO = systemConfigListApplicationService
            .getByParamGroupCode(paramGroupCode);
        return ResponseUtil.successResponse(systemConfigListDTO);
    }

    /**
     * 刷新配置缓存成功
     *
     * @param paramGroupCode 缓存标识
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "静态参数配置", description = "刷新单个配置缓存")
    @RequestMapping(value = "/clearOneByParamGroupCode", method = RequestMethod.GET)
    public ResponseUtil<String> clearOneByParamGroupCode(
        @RequestParam(value = "paramGroupCode", required = true) String paramGroupCode) {
        systemConfigListApplicationService.clearOneByParamGroupCode(paramGroupCode);
        return ResponseUtil.success(I18nUtil.get("system.config.list.cache.clear.one.success"));
    }

    /**
     * 刷新全部配置缓存成功
     *
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "静态参数配置", description = "刷新全部配置缓存")
    @RequestMapping(value = "/clearAllSystemConfigListCache", method = RequestMethod.GET)
    public ResponseUtil<String> clearAllSystemConfigListCache() {
        systemConfigListApplicationService.loadAllSystemConfigListCache();
        return ResponseUtil.success(I18nUtil.get("system.config.list.cache.clear.all.success"));
    }

}
