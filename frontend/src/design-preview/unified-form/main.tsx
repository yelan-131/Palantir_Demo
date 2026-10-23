import React from 'react';
import ReactDOM from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import UnifiedFormPreview from './App';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ConfigProvider locale={zhCN} theme={{ token: {
    colorPrimary: '#34485d', colorText: '#263445', colorTextSecondary: '#788595',
    colorBorder: '#dfe5ec', borderRadius: 6, fontSize: 13, controlHeight: 36,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  }, components: { Button: { primaryShadow: 'none', defaultShadow: 'none' }, Segmented: { trackBg: '#edf1f5' } } }}>
    <App><UnifiedFormPreview /></App>
  </ConfigProvider></React.StrictMode>,
);
