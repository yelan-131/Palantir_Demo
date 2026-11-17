import { Button } from 'antd';
import React from 'react';
import { SettingOutlined } from '@ant-design/icons';

export function RuleToggleControl({
  enabled,
  onConfig,
  onToggle,
  title,
}: {
  enabled: boolean;
  onConfig: () => void;
  onToggle: () => void;
  title: string;
}) {
  const runButtonAction = (event: React.MouseEvent<HTMLElement>, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return (
    <div className="designer-rule-toggle" data-rule-title={title} onClick={(event) => event.stopPropagation()}>
      {enabled ? (
        <Button
          className="designer-rule-config-button"
          data-rule-action="config"
          size="small"
          type="text"
          icon={<SettingOutlined />}
          onMouseDownCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => runButtonAction(event, onConfig)}
          title={`${title} config`}
        />
      ) : null}
      <button
        type="button"
        className={`designer-rule-check ${enabled ? 'designer-rule-check-on' : ''}`}
        data-rule-action="toggle"
        onMouseDownCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => runButtonAction(event, onToggle)}
        title={enabled ? `${title} enabled` : `${title} disabled`}
      >
        <span className="designer-rule-check-box" aria-hidden="true" />
      </button>
    </div>
  );
}
