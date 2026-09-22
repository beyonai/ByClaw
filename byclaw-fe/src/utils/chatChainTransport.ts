import axios from 'axios';
import { getToken, getssoToken, getSessionKey, tokenKey, ssotokenKey } from './auth';
import { generateSignature } from './signature';

// Use an isolated client: diagnostic errors must not open dialogs or trigger logout.
const client = axios.create({ timeout: 5000 });
export async function sendChatChainBatch(events: unknown[]) {
  const token = getToken();
  if (!token) throw new Error('No diagnostic session');
  const body = { events };
  const response = await client.post('/byaiService/trackLogController/chatDelivery', body, {
    headers: {
      [tokenKey]: token,
      [ssotokenKey]: getssoToken(),
      'x-session-id': getSessionKey(),
      ...generateSignature('POST', body),
    },
  });
  if (response.data?.code !== 0) throw new Error('Diagnostic batch not acknowledged');
}
