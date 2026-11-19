import type { AxiosError } from 'axios';
import { notification } from 'antd';

export const CLIENT_RENDER_ERROR = 'CLIENT_RENDER_ERROR';
const ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;

function errorCode(status: number, header: unknown): string {
  return typeof header === 'string' && ERROR_CODE_PATTERN.test(header) ? header : `HTTP_${status}`;
}

function reference(code: string, requestId?: unknown): string {
  const id = typeof requestId === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(requestId) ? requestId : '';
  return id ? `错误码 ${code} · 请求编号 ${id}` : `错误码 ${code}`;
}

export function diagnosticReference(headers?: Record<string, unknown>): string | undefined {
  const code = headers?.['x-error-code'];
  if (typeof code === 'string' && ERROR_CODE_PATTERN.test(code)) {
    return reference(code, headers?.['x-request-id']);
  }
}

export function reportApiFailure(error: AxiosError): void {
  const { response } = error;
  if (response) {
    const code = errorCode(response.status, response.headers['x-error-code']);
    const description = reference(code, response.headers['x-request-id']);
    if (response.status >= 500) {
      notification.error({ key: code, message: '服务请求失败', description });
    } else if (response.status >= 400) {
      console.info(description);
    }
    return;
  }

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    notification.error({ key: 'CLIENT_TIMEOUT', message: '请求超时', description: reference('CLIENT_TIMEOUT') });
  } else if (error.code === 'ERR_NETWORK') {
    notification.error({ key: 'CLIENT_NETWORK_ERROR', message: '无法连接服务', description: reference('CLIENT_NETWORK_ERROR') });
  }
}

export function streamHttpError(response: Response): Error {
  const code = errorCode(response.status, response.headers?.get('x-error-code'));
  const context = reference(code, response.headers?.get('x-request-id'));
  return new Error(`AI 请求失败（HTTP ${response.status}，${context}）`);
}
