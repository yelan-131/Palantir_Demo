import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2f5f73',
          colorInfo: '#2f5f73',
          colorSuccess: '#2f7d5b',
          colorWarning: '#a66f1f',
          colorError: '#a43d3d',
          colorText: '#172026',
          colorTextSecondary: '#5d6972',
          colorBgBase: '#f4f6f8',
          colorBgContainer: '#ffffff',
          colorBorder: '#d8dee4',
          borderRadius: 6,
          boxShadowSecondary: '0 8px 24px rgba(31, 44, 52, 0.08)',
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif",
        },
        components: {
          Button: {
            borderRadius: 5,
            controlHeight: 34,
            fontWeight: 600,
          },
          Card: {
            borderRadiusLG: 6,
            paddingLG: 18,
          },
          Table: {
            headerBg: '#f6f8fa',
            headerColor: '#273640',
            rowHoverBg: '#f3f7f9',
          },
          Menu: {
            itemBorderRadius: 5,
            itemHeight: 36,
          },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
