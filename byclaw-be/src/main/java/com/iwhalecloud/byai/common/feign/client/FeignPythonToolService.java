package com.iwhalecloud.byai.common.feign.client;

import java.util.List;
import java.util.Map;

import com.iwhalecloud.byai.common.feign.interceptor.FeignPythonRequestInterceptor;
import com.iwhalecloud.byai.common.feign.response.PythonToolResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.multipart.MultipartFile;
import com.iwhalecloud.byai.common.feign.response.python.BatchProgressResponse;
import com.iwhalecloud.byai.common.feign.request.python.DigEmployeeGenerate;
import com.iwhalecloud.byai.common.feign.request.python.DigitalEmployeeDuplicateCheckRequest;
import com.iwhalecloud.byai.common.feign.response.python.DigitalEmployeeDuplicateCheckResponse;
import com.iwhalecloud.byai.common.feign.request.python.EmployeeAudit;
import com.iwhalecloud.byai.common.feign.response.python.EmployeeAuditResult;

/**
 * @author he.duming
 * @date 2025-10-29 18:04:40
 * @description TODO
 */

@FeignClient(name = "${feign.python.check.name:pythonTool}", url = "${feign.python.check.url:}",
    path = "${feign.python.check.path:/bePyTc}", configuration = FeignPythonRequestInterceptor.class)
public interface FeignPythonToolService {

    /**
     * 审核数字员工
     * 
     * @param employeeAuditInfo 审核对象
     * @return ResponseUtil
     */
    @RequestMapping(value = "/v2/digitalEmployeeAudit", method = RequestMethod.POST,
        consumes = MediaType.APPLICATION_JSON_VALUE, produces = "application/json;charset=UTF-8")
    PythonToolResponse<List<EmployeeAuditResult>> digitalEmployeeAudit(@RequestBody EmployeeAudit employeeAuditInfo);

    /**
     * 数字员工重复检查
     *
     * @param request 重复检查请求
     * @return ResponseUtil
     */
    @RequestMapping(value = "/v2/digitalEmployeeDuplicateCheck", method = RequestMethod.POST,
        consumes = MediaType.APPLICATION_JSON_VALUE, produces = "application/json;charset=UTF-8")
    PythonToolResponse<DigitalEmployeeDuplicateCheckResponse> digitalEmployeeDuplicateCheck(
        @RequestBody DigitalEmployeeDuplicateCheckRequest request);

    /**
     * 数字员工一键生成接口
     * 
     * @param digEmployeeGenerate 数字员工信息
     * @return Map
     */
    @RequestMapping(value = "/v2/agent-prompt/generate", method = RequestMethod.POST,
        consumes = MediaType.APPLICATION_JSON_VALUE, produces = "application/json;charset=UTF-8")
    Map<String, Object> generate(@RequestBody DigEmployeeGenerate digEmployeeGenerate);

    @RequestMapping(value = "/cache/clear", method = RequestMethod.GET, produces = "application/json;charset=UTF-8")
    Map<String, Object> clearObjectCache(@RequestParam("objectId") Long objectId);

    /**
     * 上传Excel文件并提交任务
     *
     * @param file Excel文件 (.xlsx 或 .xls)
     * @param payloadConfigJson 完整的payload配置JSON字符串（可选）
     * @return 上传结果，包含任务ID列表
     */
    @RequestMapping(value = "/test_framework/upload", method = RequestMethod.POST,
        consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = "application/json;charset=UTF-8")
    Map<String, Object> uploadExcelAndSubmitTasks(@RequestPart("file") MultipartFile file,
        @RequestPart(value = "payload_config_json", required = false) String payloadConfigJson);

    /**
     * 下载指定批次的评测报告 (Excel格式)
     *
     * @param batchId 批次ID
     * @return Excel文件字节数组
     */
    @RequestMapping(value = "/test_framework/jobs/{batch_id}/report", method = RequestMethod.GET)
    byte[] downloadBatchReport(@PathVariable("batch_id") String batchId);

    /**
     * 获取批处理进度和任务状态
     *
     * @param batchId 批次ID
     * @return 批处理进度信息
     */
    @RequestMapping(value = "/test_framework/jobs/{batch_id}/progress", method = RequestMethod.GET,
        produces = "application/json;charset=UTF-8")
    BatchProgressResponse getBatchProgress(@PathVariable("batch_id") String batchId);

}
