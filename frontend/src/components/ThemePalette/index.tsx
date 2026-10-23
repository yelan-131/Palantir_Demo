import { Card, Typography } from 'antd';
import { THEME_SWATCHES } from '../../theme/techWhite';
import './style.css';

const groups = [
  { key: 'neutral', label: '基础色阶', description: '页面层次、边界与文字' },
  { key: 'brand', label: '品牌与交互', description: '主要操作与选中反馈' },
  { key: 'status', label: '业务状态', description: '成功、提醒与错误' },
] as const;

export default function ThemePalette() {
  return (
    <Card title="浅雾蓝 · 标准色系" className="account-panel-card theme-palette-card">
      <Typography.Paragraph type="secondary" className="theme-palette-description">
        以浅雾蓝建立层次，深蓝灰强调操作，状态色用于传达业务反馈。
      </Typography.Paragraph>
      <div className="theme-palette-groups">
        {groups.map(group => {
          const swatches = THEME_SWATCHES.filter(swatch => swatch.group === group.key);
          if (!swatches.length) return null;
          return (
            <section className="theme-palette-group" aria-label={group.label} key={group.key}>
              <div className="theme-palette-group-heading">
                <h3>{group.label}</h3>
                <span>{group.description}</span>
              </div>
              <ul className="theme-palette-swatches">
                {swatches.map(swatch => (
                  <li className="theme-palette-swatch" key={swatch.key}>
                    <span className="theme-palette-chip" style={{ backgroundColor: swatch.color }} aria-hidden="true" />
                    <div className="theme-palette-swatch-detail">
                      <div className="theme-palette-swatch-label"><strong>{swatch.label}</strong><code>{swatch.color.toUpperCase()}</code></div>
                      <span className="theme-palette-usage">{swatch.usage}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
