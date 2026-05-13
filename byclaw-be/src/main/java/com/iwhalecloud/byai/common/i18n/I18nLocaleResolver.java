package com.iwhalecloud.byai.common.i18n;

import com.iwhalecloud.byai.common.util.StringUtil;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.servlet.LocaleResolver;
import java.util.Locale;

/**
 * 获取请求头国际化信息
 *
 * @author iwhalecloud
 */
public class I18nLocaleResolver implements LocaleResolver {

    /**
     * 根据不同的请求头设置不同的语言
     *
     * @param httpServletRequest http请求
     * @return Locale 语言
     */
    @Override
    public Locale resolveLocale(HttpServletRequest httpServletRequest) {

        // 1.优先header
        String language = httpServletRequest.getHeader(I18nUtil.LANGUAGE);

        // 2. 其次从 parameter 获取
        if (StringUtil.isEmpty(language)) {
            language = httpServletRequest.getParameter(I18nUtil.LANGUAGE);
        }
        // 3. 最后从 attribute 获取
        if (StringUtil.isEmpty(language)) {
            Object attribute = httpServletRequest.getAttribute(I18nUtil.LANGUAGE);
            language = attribute != null ? attribute.toString() : I18nUtil.CHINSES;
        }

        return I18nUtil.getLanguage(language);
    }

    @Override
    public void setLocale(HttpServletRequest httpServletRequest, HttpServletResponse httpServletResponse,
        Locale locale) {
    }

}
