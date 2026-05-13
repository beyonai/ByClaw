package com.iwhalecloud.byai.manager.security.xss;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class XssFilter implements Filter {

    private Logger logger = LoggerFactory.getLogger(XssFilter.class);

    private List<Pattern> matcherList = new ArrayList<>(10);

    @Override
    public void init(FilterConfig filterConfig) {
        String temp = filterConfig.getInitParameter("excludes");
        try {
            String[] patternList = temp.split(",");
            for (String regex : patternList) {
                Pattern pattern = Pattern.compile(regex);
                matcherList.add(pattern);
            }
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }

    /**
     * 重写过滤方法
     * 
     * @param request 请求
     * @param response 响应
     * @param chain 拦截链
     * @throws IOException IOException 异常
     * @throws ServletException ServletException异常
     */
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
        throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse resp = (HttpServletResponse) response;
        String requestURI = req.getRequestURI();
        // 防止目标服务器上存在可访问任意目录下文件的漏洞：edp/report/month/sysmonitor/rpt_report_visit_num_mon_../../../../WEB-INF/web.xml
        if (requestURI.contains("WEB-INF")) {
            resp.setStatus(404);
            return;
        }
        if (StringUtils.isNotEmpty(request.getContentType()) && request.getContentType().contains("multipart/form-data")
            || checkUrlByRegex(requestURI)) {
            chain.doFilter(request, response);
        }
        else {
            XssHttpServletRequestWrapper xssRequest = new XssHttpServletRequestWrapper(req);
            chain.doFilter(xssRequest, response);
        }
    }

    /**
     * 根据正则匹配URL是否不进行xss过滤
     *
     * @param url 请求路径
     * @return boolean
     */
    private boolean checkUrlByRegex(String url) {
        for (Pattern pattern : matcherList) {
            Matcher matcher = pattern.matcher(url);
            if (matcher.find()) {
                return true;
            }
        }
        return false;
    }
}
