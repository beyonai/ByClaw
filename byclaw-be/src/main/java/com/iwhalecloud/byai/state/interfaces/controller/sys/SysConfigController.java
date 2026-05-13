package com.iwhalecloud.byai.state.interfaces.controller.sys;

import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.List;
import java.util.Map;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/system/staticdata")
public class SysConfigController {

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    /**
     * 获取静态参数
     *
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getDcSystemConfigListByStandType", method = RequestMethod.POST)
    public ResponseUtil<List<ByaiSystemConfigList>> getDcSystemConfigListByStandType(
        @RequestBody Map<String, String> params) {

        String standType = MapParamUtil.getStringValue(params, "standType");
        if (StringUtils.isBlank(standType)) {
            return ResponseUtil.fail("standType is not null");
        }

        List<ByaiSystemConfigList> dcSystemConfigValues = byaiSystemConfigService.findByParamGroupCode(standType);
        return ResponseUtil.successResponse(dcSystemConfigValues);
    }

    /**
     * 获取静态参数
     *
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getDcSystemConfigValueByCode", method = RequestMethod.POST)
    public ResponseUtil<String> getDcSystemConfigValueByCode(@RequestBody Map<String, String> params) {

        String paramCode = MapParamUtil.getStringValue(params, "paramCode");
        if (StringUtils.isBlank(paramCode)) {
            return ResponseUtil.fail("paramCode is not null");
        }

        return ResponseUtil.successResponse(byaiSystemConfigService.getDcSystemConfigValueByCode(paramCode));
    }


    /**
     * 获取静态参数
     *
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getDcSystemConfigValueByCodes", method = RequestMethod.POST)
    public ResponseUtil<List<ByaiSystemConfig>> getDcSystemConfigValueByCodes(@RequestBody Map<String, Object> params) {

        if (MapUtils.isEmpty(params)) {
            return ResponseUtil.fail("paramCode is not null");
        }

        return ResponseUtil.successResponse(byaiSystemConfigService.getDcSystemConfigValueByCodes(params));
    }

}
