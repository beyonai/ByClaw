package com.iwhalecloud.byai.manager.interfaces.controller.staticdata;

import com.iwhalecloud.byai.manager.application.service.staticdata.StaticDataQueryApplicationService;
import com.iwhalecloud.byai.manager.dto.staticdata.DcSystemConfigDTO;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

/**
 * 系统配置列表控制器
 */
@RestController
@RequestMapping("/system/staticdata")
public class StaticDataQueryController {

    @Autowired
    private StaticDataQueryApplicationService staticDataQueryApplicationService;

    /**
     * 获取静态参数
     *
     * @param dcSystemConfigQo 入参
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getDcSystemConfig", method = RequestMethod.POST)
    public ResponseUtil<ByaiSystemConfig> getDcSystemConfig(
        @RequestBody @Validated DcSystemConfigDTO dcSystemConfigQo) {

        String paramCode = dcSystemConfigQo.getParamCode();
        ByaiSystemConfig dcSystemConfig = staticDataQueryApplicationService.getDcSystemConfig(paramCode);

        return ResponseUtil.successResponse(dcSystemConfig);
    }

    /**
     * 根据类型查询静态参数列表）
     * 
     * @param configListByStandTypeDTO 入参
     * @return ResponseUtil
     */
//    @RequestMapping(value = "/getDcSystemConfigListByStandType", method = RequestMethod.POST)
//    public ResponseUtil<List<Map<String, Object>>> getDcSystemConfigListByStandType(HttpServletRequest request,
//        @RequestBody @Validated ConfigListByStandTypeDTO configListByStandTypeDTO) {
//        String language = request.getHeader(I18nUtil.LANGUAGE);
//        String standType = configListByStandTypeDTO.getStandType();
//        List<Map<String, Object>> results = staticDataQueryApplicationService.getDcSystemConfigList(language,
//            standType);
//        return ResponseUtil.successResponse(results);
//    }

}
