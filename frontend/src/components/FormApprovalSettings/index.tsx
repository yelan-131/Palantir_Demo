import { useEffect, useState } from 'react';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Spin, Switch, Tag, Typography, message } from 'antd';
import { getFormApprovalSettings, saveFormApprovalSettings, formApprovalError, type ApprovalStage, type FormApprovalSettings as Settings } from '@/services/formApprovals';
import './style.css';

const newStage = (number: number): ApprovalStage => ({ name: `第 ${number} 步审批`, approver_ids: [], approval_mode: 'single' });

export default function FormApprovalSettings({ formId }: { formId?: number }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [stages, setStages] = useState<ApprovalStage[]>([]);
  const [replacing, setReplacing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const accept = (next: Settings) => {
    setSettings(next);
    setEnabled(next.enabled);
    setStages(next.stages.length ? next.stages.map((stage) => ({ ...stage, approver_ids: [...stage.approver_ids] })) : [newStage(1)]);
    setReplacing(false);
  };

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setError('');
    setReplacing(false);
    if (!formId) return;
    setLoading(true);
    getFormApprovalSettings(formId)
      .then(({ data }) => { if (!cancelled) accept(data.data); })
      .catch((failure) => { if (!cancelled) setError(formApprovalError(failure)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [formId, reload]);

  const editable = Boolean(settings && (settings.editable || replacing));
  const changeStage = (index: number, patch: Partial<ApprovalStage>) => setStages((current) => current.map((stage, position) => position === index ? { ...stage, ...patch } : stage));
  const moveStage = (index: number, delta: number) => setStages((current) => {
    const next = [...current];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    return next;
  });

  const save = async () => {
    if (!formId || !settings || !editable) return;
    if (enabled && (!stages.length || stages.some((stage) => !stage.name.trim() || !stage.approver_ids.length))) {
      message.warning('请为每一步填写名称并选择至少一位审批人。');
      return;
    }
    setSaving(true);
    try {
      const { data } = await saveFormApprovalSettings(formId, {
        enabled,
        stages: stages.map((stage) => ({ ...stage, name: stage.name.trim() })),
        replace_existing: replacing,
        expected_version: settings.workflow_version ?? settings.version ?? null,
      });
      accept(data.data);
      message.success(enabled ? '审批流程已发布，新提交将使用此配置。' : '审批已停用，正在运行的审批继续按原流程处理。');
    } catch (failure) {
      message.error(formApprovalError(failure));
    } finally {
      setSaving(false);
    }
  };

  if (!formId) return <Empty description="请先保存业务表单，再配置审批流程。" />;
  if (loading) return <div className="form-approval-loading"><Spin tip="正在加载审批设置" /></div>;
  if (error) return <Alert type="error" showIcon message={error} action={<Button onClick={() => setReload((value) => value + 1)}>重试</Button>} />;
  if (!settings) return null;

  return (
    <div className="form-approval-settings">
      <div className="form-approval-heading">
        <div>
          <Typography.Title level={4}>审批设置</Typography.Title>
          <Typography.Text type="secondary">为当前业务表单指定审批人和步骤，提交后进入统一的流程与待办。</Typography.Text>
        </div>
        <Tag color={settings.enabled ? 'green' : 'default'}>{settings.enabled ? '审批已启用' : '审批未启用'}{settings.workflow_version ? ` · v${settings.workflow_version}` : ''}</Tag>
      </div>
      <Alert type="info" showIcon message="保存即发布，适用于之后新提交或重新提交的申请。正在审批的申请保留原流程版本和审批人。" />
      {settings.requires_replacement && !replacing && (
        <Alert type="warning" showIcon message="此表单已有独立流程配置" description={
          <Space direction="vertical">
            <span>{settings.existing_workflows.map((workflow) => workflow.name).join('、')}。现有流程继续保留，可在“流程设计”中维护。</span>
            <Button onClick={() => Modal.confirm({
              title: '为此表单改用新的审批步骤？',
              content: '保存后，仅此表单未来提交的审批绑定将被替换。原流程定义和已发起的审批保留；条件分支、动态审批人等复杂规则不会复制到新流程中。',
              okText: '配置新的审批步骤', cancelText: '保留现有流程',
              onOk: () => { setReplacing(true); setEnabled(true); setStages([newStage(1)]); },
            })}>设置新的审批流程</Button>
          </Space>
        } />
      )}
      {replacing && <Alert type="warning" showIcon message="正在配置替换流程。点击保存后，仅未来提交改用下方步骤。" />}
      <div className="form-approval-enable">
        <Space><Switch checked={enabled} disabled={!editable || saving} onChange={setEnabled} aria-label="启用表单审批" /><strong>启用表单审批</strong></Space>
        <Typography.Text type="secondary">启用后，业务表单先保存草稿，确认提交后生成审批任务；驳回后可修改并重新提交。</Typography.Text>
      </div>
      {(enabled || replacing) && (!settings.requires_replacement || replacing) && (
        <div className="form-approval-stages">
          {stages.map((stage, index) => (
            <Card key={index} size="small" title={`步骤 ${index + 1}`} extra={editable && <Space size={4}>
              <Button size="small" title="上移步骤" aria-label={`上移步骤 ${index + 1}`} icon={<ArrowUpOutlined />} disabled={index === 0 || saving} onClick={() => moveStage(index, -1)} />
              <Button size="small" title="下移步骤" aria-label={`下移步骤 ${index + 1}`} icon={<ArrowDownOutlined />} disabled={index === stages.length - 1 || saving} onClick={() => moveStage(index, 1)} />
              <Button size="small" danger title="删除步骤" aria-label={`删除步骤 ${index + 1}`} icon={<DeleteOutlined />} disabled={stages.length === 1 || saving} onClick={() => setStages((current) => current.filter((_, position) => position !== index))} />
            </Space>}>
              <div className="form-approval-stage-fields">
                <label><span>步骤名称</span><Input value={stage.name} maxLength={100} disabled={!editable || saving} onChange={(event) => changeStage(index, { name: event.target.value })} aria-label={`步骤 ${index + 1} 名称`} /></label>
                <label><span>审批人</span><Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择审批人" value={stage.approver_ids} disabled={!editable || saving} options={settings.available_users.map((user) => ({ value: user.id, label: user.name }))} onChange={(approver_ids: number[]) => changeStage(index, { approver_ids })} aria-label={`步骤 ${index + 1} 审批人`} /></label>
                <label><span>通过规则</span><Select value={stage.approval_mode} disabled={!editable || saving} options={[{ value: 'single', label: '任一审批人通过' }, { value: 'countersign', label: '所有审批人通过（会签）' }]} onChange={(approval_mode: ApprovalStage['approval_mode']) => changeStage(index, { approval_mode })} aria-label={`步骤 ${index + 1} 通过规则`} /></label>
              </div>
              <Typography.Text type="secondary">{stage.approval_mode === 'countersign' ? '本步骤所有审批人通过后进入下一步；任何人驳回都会退回申请。' : '本步骤任一审批人通过后进入下一步；驳回会退回申请。'}</Typography.Text>
            </Card>
          ))}
          {editable && <Button block type="dashed" disabled={saving} icon={<PlusOutlined />} onClick={() => setStages((current) => [...current, newStage(current.length + 1)])}>添加审批步骤</Button>}
        </div>
      )}
      {editable && <Space className="form-approval-actions">
        <Button type="primary" loading={saving} icon={<SaveOutlined />} onClick={save}>保存审批设置</Button>
        <Button disabled={saving} onClick={() => accept(settings)}>恢复已保存配置</Button>
      </Space>}
    </div>
  );
}
