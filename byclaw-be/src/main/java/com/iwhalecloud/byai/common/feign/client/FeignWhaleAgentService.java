package com.iwhalecloud.byai.common.feign.client;

import java.util.Map;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.feign.interceptor.FeignWhaleAgentRequestInterceptor;
import com.iwhalecloud.byai.common.feign.request.sandbox.RenewSandboxTimeoutRequest;
import com.iwhalecloud.byai.common.feign.request.sandbox.WhaleAgentListFilesRequest;
import com.iwhalecloud.byai.common.feign.request.sandbox.WhaleAgentListSandboxesRequest;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxCreateResult;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxRenewResult;
import com.iwhalecloud.byai.common.feign.response.sandbox.WhaleAgentFileItem;
import com.iwhalecloud.byai.common.feign.response.sandbox.WhaleAgentSandboxPageResult;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;
import feign.Response;

@FeignClient(name = "${feign.whale-agent.name:whale-agent}", url = "${feign.whale-agent.url:}",
    path = "${feign.whale-agent.path:/knowledge/knowledgeService}", contextId = "whaleAgentServiceClient",
    configuration = FeignWhaleAgentRequestInterceptor.class)
public interface FeignWhaleAgentService {

    @RequestMapping(value = "/sandboxExternal/launchSandbox", method = RequestMethod.POST,
        produces = MediaType.APPLICATION_JSON_VALUE, consumes = MediaType.APPLICATION_JSON_VALUE)
    KnowledgeResponse<SandboxCreateResult> launchSandbox(@RequestBody Map<String, Object> request);

    @RequestMapping(value = "/sandboxExternal/destroySandbox", method = RequestMethod.POST,
        produces = MediaType.APPLICATION_JSON_VALUE, consumes = MediaType.APPLICATION_JSON_VALUE)
    KnowledgeResponse<Void> destroySandbox(@RequestBody Map<String, Object> request);

    @RequestMapping(value = "/sandboxExternal/renewSandboxTimeout", method = RequestMethod.POST,
        produces = MediaType.APPLICATION_JSON_VALUE, consumes = MediaType.APPLICATION_JSON_VALUE)
    KnowledgeResponse<SandboxRenewResult> renewSandboxTimeout(@RequestBody RenewSandboxTimeoutRequest request);

    @RequestMapping(value = "/sandboxExternal/getSandboxInfo", method = RequestMethod.POST,
        produces = MediaType.APPLICATION_JSON_VALUE, consumes = MediaType.APPLICATION_JSON_VALUE)
    KnowledgeResponse<SandboxDetail> getSandboxInfo(@RequestBody Map<String, Object> request);

    @RequestMapping(value = "/sandboxExternal/listSandboxes", method = RequestMethod.POST,
        produces = MediaType.APPLICATION_JSON_VALUE, consumes = MediaType.APPLICATION_JSON_VALUE)
    KnowledgeResponse<WhaleAgentSandboxPageResult> listSandboxes(@RequestBody WhaleAgentListSandboxesRequest request);

    @RequestMapping(value = "/sandboxExternal/uploadFile", method = RequestMethod.POST,
        consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    KnowledgeResponse<Void> uploadFile(@RequestPart("filePath") String filePath,
                                       @RequestPart("fileShareType") String fileShareType,
                                       @RequestPart("file") MultipartFile file);

    @RequestMapping(value = "/sandboxExternal/downloadFile", method = RequestMethod.POST,
        consumes = MediaType.APPLICATION_JSON_VALUE)
    Response downloadFile(@RequestBody java.util.Map<String, Object> request);

    @RequestMapping(value = "/sandboxExternal/listFiles", method = RequestMethod.POST,
        consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    KnowledgeResponse<java.util.List<WhaleAgentFileItem>> listFiles(@RequestBody WhaleAgentListFilesRequest request);

    @RequestMapping(value = "/sandboxExternal/existsFile", method = RequestMethod.POST,
        consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    KnowledgeResponse<Boolean> existsFile(@RequestBody WhaleAgentListFilesRequest request);

    @RequestMapping(value = "/sandboxExternal/deleteFile", method = RequestMethod.POST,
        consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    KnowledgeResponse<Void> deleteFile(@RequestBody WhaleAgentListFilesRequest request);
}
