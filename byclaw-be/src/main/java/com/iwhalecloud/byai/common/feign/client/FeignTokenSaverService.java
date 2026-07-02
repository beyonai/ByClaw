package com.iwhalecloud.byai.common.feign.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;

import com.iwhalecloud.byai.common.feign.interceptor.FeignTokenSaverRequestInterceptor;
import com.iwhalecloud.byai.common.feign.request.token.TokenBatchIdsRequest;
import com.iwhalecloud.byai.common.feign.request.token.TokenSaveRequest;
import com.iwhalecloud.byai.common.feign.response.token.TokenApiResponse;
import com.iwhalecloud.byai.common.feign.response.token.TokenBatchKeysResult;
import com.iwhalecloud.byai.common.feign.response.token.TokenDto;
import com.iwhalecloud.byai.common.feign.response.token.TokenKeyResult;
import com.iwhalecloud.byai.common.feign.response.token.TokenPageResult;

/**
 * Token API（/api/token）Feign 客户端。
 */
@FeignClient(name = "${feign.tokenSaver.name:TokenSaver}", url = "${feign.tokenSaver.url:}", contextId = "TokenSaver",
    configuration = FeignTokenSaverRequestInterceptor.class)
public interface FeignTokenSaverService {

    /**
     * 查询令牌列表（分页）。
     */
    @RequestMapping(value = "/api/token/", method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    TokenApiResponse<TokenPageResult> listTokens(@RequestParam(value = "p", required = false) Integer page,
        @RequestParam(value = "page_size", required = false) Integer pageSize,
        @RequestParam(value = "ps", required = false) Integer ps,
        @RequestParam(value = "size", required = false) Integer size);

    /**
     * 搜索令牌（分页）。
     */
    @RequestMapping(value = "/api/token/search", method = RequestMethod.GET,
        produces = MediaType.APPLICATION_JSON_VALUE)
    TokenApiResponse<TokenPageResult> searchTokens(@RequestParam(value = "keyword", required = false) String keyword,
        @RequestParam(value = "token", required = false) String token,
        @RequestParam(value = "p", required = false) Integer page,
        @RequestParam(value = "page_size", required = false) Integer pageSize);

    /**
     * 查询单个令牌详情。
     */
    @RequestMapping(value = "/api/token/{id}", method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    TokenApiResponse<TokenDto> getToken(@PathVariable("id") Integer id);

    /**
     * 获取单个令牌完整密钥。
     */
    @RequestMapping(value = "/api/token/{id}/key", method = RequestMethod.POST,
        produces = MediaType.APPLICATION_JSON_VALUE, consumes = MediaType.APPLICATION_JSON_VALUE)
    TokenApiResponse<TokenKeyResult> getTokenKey(@PathVariable("id") Integer id);

    /**
     * 批量获取令牌完整密钥。
     */
    @RequestMapping(value = "/api/token/batch/keys", method = RequestMethod.POST,
        produces = MediaType.APPLICATION_JSON_VALUE, consumes = MediaType.APPLICATION_JSON_VALUE)
    TokenApiResponse<TokenBatchKeysResult> batchGetTokenKeys(@RequestBody TokenBatchIdsRequest request);

    /**
     * 新增令牌。
     */
    @RequestMapping(value = "/api/token/", method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE,
        consumes = MediaType.APPLICATION_JSON_VALUE)
    TokenApiResponse<Void> createToken(@RequestBody TokenSaveRequest request);

    /**
     * 修改令牌（与新增同路径）。
     */
    @RequestMapping(value = "/api/token/", method = RequestMethod.PUT, produces = MediaType.APPLICATION_JSON_VALUE,
        consumes = MediaType.APPLICATION_JSON_VALUE)
    TokenApiResponse<TokenDto> updateToken(@RequestBody TokenSaveRequest request,
        @RequestParam(value = "status_only", required = false) String statusOnly);

    /**
     * 删除单个令牌。
     */
    @RequestMapping(value = "/api/token/{id}", method = RequestMethod.DELETE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    TokenApiResponse<Void> deleteToken(@PathVariable("id") Integer id);

    /**
     * 批量删除令牌。
     */
    @RequestMapping(value = "/api/token/batch", method = RequestMethod.POST,
        produces = MediaType.APPLICATION_JSON_VALUE, consumes = MediaType.APPLICATION_JSON_VALUE)
    TokenApiResponse<Integer> batchDeleteTokens(@RequestBody TokenBatchIdsRequest request);
}
