package com.iwhalecloud.byai.manager.security.login.cas;

import java.io.StringReader;
import java.math.BigInteger;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;
import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.login.bean.CasTicketUser;
import org.apache.commons.lang3.StringUtils;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.util.EntityUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Component;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.security.exception.bean.LoginAuthenticationException;
import com.iwhalecloud.byai.common.constants.login.LoginType;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.xml.sax.Attributes;
import org.xml.sax.InputSource;
import org.xml.sax.XMLReader;
import org.xml.sax.helpers.DefaultHandler;
import javax.xml.parsers.SAXParserFactory;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 账号密码登录认证
 */
@Component
public class CasAuthenticationProvider implements AuthenticationProvider {

    private static final Logger logger = LoggerFactory.getLogger(CasAuthenticationProvider.class);

    @Value("${cas.validate.url:http://10.166.33.135/cas/p3/serviceValidate}")
    private String casValidateUrl;

    @Value("${cas.service.url:http://10.166.33.135/aiznpt/}")
    private String casServiceUrl;

    @Autowired
    private UserService userService;

    @Autowired
    private UserApplicationService userApplicationService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    public CasAuthenticationProvider() {
        super();
    }

    /**
     * 登陆认证
     * 
     * @param authentication 认证信息
     * @return Authentication
     */
    @Override
    public Authentication authenticate(Authentication authentication) throws AuthenticationException {

        // 获取ticket
        String ticket = authentication.getPrincipal().toString();
        if (StringUtil.isEmpty(ticket)) {
            throw new BadCredentialsException(I18nUtil.get("login.ticket.notnull"));
        }

        CasTicketUser casTicketUser = this.getCasTicketUser(ticket);
        Users users = userService.findByUserCode(casTicketUser.getUserName());
        if (users == null) {
            users = userApplicationService.registerByCasTicketUser(casTicketUser);
        }

        // 检查用户是否有效
        String checkResult = loginApplicationService.checkUserIsValid(users);
        if (StringUtil.isNotEmpty(checkResult)) {
            throw new LoginAuthenticationException(users.getUserId(), LoginType.CAS, null, checkResult);
        }

        // 认证通过，返回token
        CasAuthentication casAuthentication = new CasAuthentication();
        casAuthentication.setUsers(users);
        casAuthentication.setAuthenticated(true);
        return casAuthentication;
    }

    /**
     * 主入口
     *
     * @param ticket 参数Map，包含ticket等
     * @return 用户信息Map
     */
    public CasTicketUser getCasTicketUser(String ticket) {

        try {

            // 1. CAS票据验证
            Map<String, String> params = Map.of("ticket", ticket, "service", this.casServiceUrl);
            String casUrl = this.buildUrl(this.casValidateUrl, params);
            logger.info("请求cas验证地址: {}", casUrl);

            String casResponse = p3ServiceValidate(casUrl);
            logger.info("请求cas验证响应: {}", casResponse);

            // 2. 检查验证错误
            String error = this.getValidateError(casResponse);
            if (StringUtils.isNotEmpty(error)) {
                throw new BadCredentialsException(I18nUtil.get("login.cas.sso.failed"));
            }

            // 3. 获取用户名
            String userName = this.getPrincipal(casResponse);
            if (StringUtils.isEmpty(userName)) {
                throw new BadCredentialsException(I18nUtil.get("login.cas.cannot.get.username"));
            }

            // 4. 根据用户名计算出唯一id
            long userId = this.get18DigitUserId(userName);

            // 5. 构造用户信息
            CasTicketUser casTicketUser = new CasTicketUser();
            casTicketUser.setUserId(userId);
            casTicketUser.setUserName(userName);
            return casTicketUser;
        }
        catch (Exception e) {
            logger.error("解析XML时发生异常: {}", e.getMessage(), e);
            throw new BadCredentialsException(I18nUtil.get("login.cas.xml.parse.exception"));
        }
    }

    /**
     * 构造带参数的URL
     *
     * @param base 基础URL
     * @param params 参数Map
     * @return 完整URL
     */
    private String buildUrl(String base, Map<String, String> params) {
        if (params != null && !params.isEmpty()) {
            StringBuilder query = new StringBuilder();
            boolean first = true;
            for (Map.Entry<String, String> entry : params.entrySet()) {
                if (!first) {
                    query.append("&");
                }
                try {
                    query.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8.toString())).append("=")
                        .append(URLEncoder.encode(entry.getValue() != null ? entry.getValue() : "",
                            StandardCharsets.UTF_8.toString()));
                }
                catch (Exception e) {
                    logger.warn("URL编码失败: {}", e.getMessage(), e);
                    query.append(entry.getKey()).append("=").append(entry.getValue() != null ? entry.getValue() : "");
                }
                first = false;
            }
            return base + (base.contains("?") ? "&" : "?") + query.toString();
        }
        return base;
    }

    /**
     * CAS服务验证
     *
     * @param casUrl CAS验证URL
     * @return 响应内容
     */
    private String p3ServiceValidate(String casUrl) {
        try (CloseableHttpClient httpClient = HttpClients.createDefault()) {
            HttpGet httpGet = new HttpGet(casUrl);
            RequestConfig config = RequestConfig.custom().setConnectTimeout(5000).setSocketTimeout(5000).build();
            httpGet.setConfig(config);

            try (CloseableHttpResponse response = httpClient.execute(httpGet)) {
                String res = EntityUtils.toString(response.getEntity(), StandardCharsets.UTF_8);
                if (StringUtils.isBlank(res)) {
                    throw new BadCredentialsException(I18nUtil.get("login.cas.access.sso.service.failed", casUrl));
                }
                return res;
            }
        }
        catch (Exception e) {
            logger.error("CAS服务验证请求异常: {}", e.getMessage(), e);
            throw new BadCredentialsException(I18nUtil.get("login.cas.service.verify.failed"), e);
        }
    }

    /**
     * 获取验证错误信息
     *
     * @param res XML响应内容
     * @return 错误信息
     */
    private String getValidateError(String res) {
        return getTextForElement(res, "authenticationFailure");
    }

    /**
     * 获取用户名
     *
     * @param res XML响应内容
     * @return 用户名
     */
    private String getPrincipal(String res) {
        return this.getTextForElement(res, "user");
    }

    /**
     * XML工具方法 - 获取指定元素的文本内容
     *
     * @param xmlAsString XML字符串
     * @param element 元素名
     * @return 元素文本内容
     */
    private String getTextForElement(String xmlAsString, String element) {
        try {
            XMLReader reader = getXmlReader();
            StringBuilder builder = new StringBuilder();
            DefaultHandler handler = new DefaultHandler() {

                private boolean foundElement = false;

                @Override
                public void startElement(String uri, String localName, String qName, Attributes attributes) {
                    if (localName.equals(element) || qName.equals(element)) {
                        this.foundElement = true;
                    }
                }

                @Override
                public void endElement(String uri, String localName, String qName) {
                    if (localName.equals(element) || qName.equals(element)) {
                        this.foundElement = false;
                    }
                }

                @Override
                public void characters(char[] ch, int start, int length) {
                    if (this.foundElement) {
                        builder.append(ch, start, length);
                    }
                }
            };
            reader.setContentHandler(handler);
            reader.setErrorHandler(handler);
            reader.parse(new InputSource(new StringReader(xmlAsString)));
            return builder.toString();
        }
        catch (Exception e) {
            logger.error("解析XML时发生异常: {}", e.getMessage(), e);
            return null;
        }
    }

    /**
     * 获取XML读取器
     *
     * @return XMLReader实例
     */
    private XMLReader getXmlReader() {
        try {
            XMLReader reader = SAXParserFactory.newInstance().newSAXParser().getXMLReader();
            reader.setFeature("http://xml.org/sax/features/namespaces", true);
            reader.setFeature("http://xml.org/sax/features/namespace-prefixes", false);
            reader.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            return reader;
        }
        catch (Exception e) {
            logger.error("XmlReader不可用: {}", e.getMessage(), e);
            throw new BadCredentialsException(I18nUtil.get("login.cas.unable.to.create.xml.reader"), e);
        }
    }

    /**
     * 获取18位用户ID
     *
     * @param userName 用户名
     * @return 18位用户ID
     */
    private long get18DigitUserId(String userName) {
        try {
            // 1. 计算SHA-256哈希（256位）
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = md.digest(userName.getBytes(StandardCharsets.UTF_8));

            // 2. 转换为正大整数（0到2^256-1）
            BigInteger hashNumber = new BigInteger(1, hashBytes);

            // 3. 取模运算，确保结果在 10^17 到 10^18-1 之间（即18位数字）
            BigInteger min18Digit = BigInteger.TEN.pow(17); // 10^17（最小18位数：100...000）
            BigInteger max18Digit = BigInteger.TEN.pow(18).subtract(BigInteger.ONE); // 10^18-1（999...999）

            // 公式：hashNumber % (max18Digit - min18Digit + 1) + min18Digit
            BigInteger range = max18Digit.subtract(min18Digit).add(BigInteger.ONE);
            BigInteger id = hashNumber.mod(range).add(min18Digit);

            return id.longValue();
        }
        catch (NoSuchAlgorithmException e) {
            logger.error("SHA-256算法不可用: {}", e.getMessage(), e);
            throw new BadCredentialsException(I18nUtil.get("login.cas.sha256.algorithm.unavailable"), e);
        }
    }

    /**
     * 类型的支持
     * 
     * @param authentication 认证信息
     * @return supports
     */
    @Override
    public boolean supports(Class<?> authentication) {
        return authentication.isAssignableFrom(CasAuthentication.class);
    }
}
