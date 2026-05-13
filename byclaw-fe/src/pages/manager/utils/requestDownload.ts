// @ts-nocheck
import axios from 'axios';
import { getToken, getssoToken } from '@/pages/manager/utils/auth';

const download = async (url: string, options: any = {}, callback?: (success: boolean) => void) => {
  const { method = 'POST', body, prefix } = options;
  const context = prefix || 'byaiService';
  const fullUrl = `/${context}${url}`;

  const headers: any = {
    'Content-Type': 'application/json',
  };

  const token = getToken();
  const ssoToken = getssoToken();
  if (token) headers['Beyond-Token'] = token;
  if (ssoToken) headers['SSO-TOKEN'] = ssoToken;

  try {
    const response = await axios({
      url: fullUrl,
      method,
      data: body,
      headers,
      responseType: 'blob',
    });

    const blob = response.data;
    const contentDisposition = response.headers['content-disposition'];
    let filename = 'download';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match) filename = decodeURIComponent(match[1].replace(/['"]/g, ''));
    }

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    if (callback) {
      callback(true);
    }
  } catch (error) {
    console.error('下载失败:', error);
    if (callback) {
      callback(false);
    }
  }
};

export default download;
