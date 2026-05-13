package com.iwhalecloud.byai.manager.interfaces.controller.operations;

import com.iwhalecloud.byai.manager.dto.operations.OperationsQueryRequest;
import com.iwhalecloud.byai.manager.dto.operations.QueryConfigListDTO;
import com.iwhalecloud.byai.manager.domain.operations.service.OperationsQueryService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * 运营看板控制器 提供运营数据分析的RESTful接口
 *
 * @author ByAI Team &#064;date 2025-10-30
 */
@RestController
@RequestMapping("/operations/dashboard")
public class OperationsDashboardController {

    @Autowired
    private OperationsQueryService operationsQueryService;

    /**
     * 执行运营看板查询 根据queryCode和queryType动态执行对应的SQL查询
     *
     * @param request 查询请求，包含queryCode、queryType、日期范围等参数
     * @return 查询结果，包含数据列表和分页信息
     */
    @RequestMapping(value = "/query", method = RequestMethod.POST)
    public ResponseUtil query(@Validated @RequestBody OperationsQueryRequest request) {
        Map<String, Object> result = operationsQueryService.executeQuery(request);
        return ResponseUtil.successResponse(result);
    }

    /**
     * 查询所有启用的查询配置列表（不包含SQL模板）
     *
     * @return 查询配置列表，包含queryCode、queryName、dimensionFields、measureFields、conditionFields
     */
    @RequestMapping(value = "/config/list", method = RequestMethod.GET)
    public ResponseUtil<List<QueryConfigListDTO>> getAllConfigList() {
        return ResponseUtil.successResponse(operationsQueryService.getAllConfigList());
    }

}
