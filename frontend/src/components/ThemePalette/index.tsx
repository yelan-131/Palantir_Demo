import { Card, Typography } from 'antd';
import type { ThemeCard, ThemeCardPalette } from '../../theme/cards';
import './style.css';
import '../../pages/AccountCenter/account.css';

const groups: Array<{ label: string; description: string; swatches: Array<[keyof ThemeCardPalette, string, string]> }> = [
  { label: '基础色阶', description: '页面层次、边界与文字', swatches: [
    ['canvas', '画布', '工作区底色'], ['surface', '面板', '卡片、表格、弹窗'], ['border', '边框', '分隔与控件描边'],
    ['text', '正文', '标题与正文'], ['text2', '次要正文', '表单标签、说明'], ['muted', '辅助', '时间、表头、占位'],
  ] },
  { label: '导航与交互', description: '外壳、主要操作与选中反馈', swatches: [
    ['rail', '应用栏', '最左侧应用切换'], ['side', '导航', '二级菜单'], ['accent', '主色', '主要按钮、链接'],
    ['selected', '选中底', '选中行与选项'], ['indicator', '刻线', '当前位置标记'], ['focus', '焦点', '键盘焦点框'],
  ] },
  { label: '业务状态', description: '成功、提醒、错误与信息', swatches: [
    ['success', '成功', '已完成、正常'], ['warning', '提醒', '待处理、临期'], ['danger', '错误', '失败、超限'], ['info', '信息', '进行中、提示'],
  ] },
];

export default function ThemePalette({ card }: { card: ThemeCard }) {
  return (
    <Card title={`${card.name} · 色板`} className="account-panel-card theme-palette-card">
      <Typography.Paragraph type="secondary" className="theme-palette-description">{card.description}</Typography.Paragraph>
      <div className="theme-palette-groups">
        {groups.map(group => (
          <section className="theme-palette-group" aria-label={group.label} key={group.label}>
            <div className="theme-palette-group-heading">
              <h3>{group.label}</h3>
              <span>{group.description}</span>
            </div>
            <ul className="theme-palette-swatches">
              {group.swatches.map(([key, label, usage]) => (
                <li className="theme-palette-swatch" key={key}>
                  <span className="theme-palette-chip" style={{ backgroundColor: card.palette[key] }} aria-hidden="true" />
                  <div className="theme-palette-swatch-detail">
                    <div className="theme-palette-swatch-label"><strong>{label}</strong><code>{card.palette[key]}</code></div>
                    <span className="theme-palette-usage">{usage}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}
