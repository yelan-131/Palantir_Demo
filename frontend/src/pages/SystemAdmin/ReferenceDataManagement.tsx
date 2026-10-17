import SettingsTabs from '@/components/SettingsTabs';
import { useEffect, useMemo, useState } from 'react';
import {
  ApartmentOutlined,
  DatabaseOutlined,
  PlusOutlined,
  ProfileOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Empty, Form, Input, Modal, Row, Segmented, Space, Table, Tag, Typography, message } from 'antd';
import { getReferenceData, saveReferenceData } from '@/services/api';

type DictionaryItem = {
  id: string;
  dictCode: string;
  dictName: string;
  scope: string;
  owner: string;
  options: Array<{ label: string; value: string; enabled: boolean }>;
};

type MasterDataType = {
  id: string;
  name: string;
  code: string;
  owner: string;
  description: string;
  fields: Array<{ name: string; label: string; type: string; role: string }>;
  records: Array<Record<string, string>>;
};

const emptyReferenceData = { dictionaries: [] as DictionaryItem[], masterData: [] as MasterDataType[] };

function normalizeReferencePayload(payload: any) {
  return {
    dictionaries: Array.isArray(payload?.dictionaries) ? payload.dictionaries as DictionaryItem[] : [],
    masterData: Array.isArray(payload?.masterData) ? payload.masterData as MasterDataType[] : [],
  };
}

function splitOptions(value: unknown) {
  return String(value || '')
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({ label: item, value: item, enabled: true }));
}

export default function ReferenceDataManagement() {
  const [mode, setMode] = useState<'dictionary' | 'master'>('dictionary');
  const [dictionaries, setDictionaries] = useState<DictionaryItem[]>([]);
  const [masterData, setMasterData] = useState<MasterDataType[]>([]);
  const [selectedMasterId, setSelectedMasterId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [masterOpen, setMasterOpen] = useState(false);
  const [dictionaryForm] = Form.useForm();
  const [masterForm] = Form.useForm();

  const selectedMaster = masterData.find((item) => item.id === selectedMasterId) || masterData[0];
  const recordColumns = useMemo(() => selectedMaster?.fields.map((field) => ({
    title: field.label,
    dataIndex: field.name,
    key: field.name,
  })) || [], [selectedMaster]);

  const loadReferenceData = async () => {
    setLoading(true);
    try {
      const response = await getReferenceData();
      const next = normalizeReferencePayload(response.data?.data ?? emptyReferenceData);
      setDictionaries(next.dictionaries);
      setMasterData(next.masterData);
      setSelectedMasterId((prev) => (
        next.masterData.some((item) => item.id === prev)
          ? prev
          : next.masterData[0]?.id
      ));
    } catch (error: any) {
      setDictionaries([]);
      setMasterData([]);
      setSelectedMasterId(undefined);
      message.warning(error?.response?.data?.detail ?? '参考数据接口暂不可用');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReferenceData();
  }, []);

  const persistReferenceData = async (next: { dictionaries: DictionaryItem[]; masterData: MasterDataType[] }) => {
    setSaving(true);
    try {
      await saveReferenceData(next);
      setDictionaries(next.dictionaries);
      setMasterData(next.masterData);
      setSelectedMasterId((prev) => (
        next.masterData.some((item) => item.id === prev)
          ? prev
          : next.masterData[0]?.id
      ));
      message.success('参考数据已保存到数据库');
    } catch (error: any) {
      message.error(error?.response?.data?.detail ?? '保存失败');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const addDictionary = async () => {
    const values = await dictionaryForm.validateFields();
    const nextDictionaries = [
      ...dictionaries,
      {
        id: String(Date.now()),
        dictCode: values.dictCode,
        dictName: values.dictName,
        scope: values.scope || '通用',
        owner: values.owner || '系统管理',
        options: splitOptions(values.options),
      },
    ];
    await persistReferenceData({ dictionaries: nextDictionaries, masterData });
    dictionaryForm.resetFields();
    setDictionaryOpen(false);
  };

  const addMaster = async () => {
    const values = await masterForm.validateFields();
    const nextMaster: MasterDataType = {
      id: String(Date.now()),
      name: values.name,
      code: values.code,
      owner: values.owner || '系统管理',
      description: values.description || '',
      fields: [],
      records: [],
    };
    await persistReferenceData({ dictionaries, masterData: [...masterData, nextMaster] });
    setSelectedMasterId(nextMaster.id);
    masterForm.resetFields();
    setMasterOpen(false);
  };

  const dictionaryColumns = [
    { title: '字典名称', dataIndex: 'dictName', width: 160 },
    { title: '字典编码', dataIndex: 'dictCode', width: 180 },
    { title: '适用范围', dataIndex: 'scope', width: 140 },
    { title: '维护方', dataIndex: 'owner', width: 140 },
    {
      title: '选项',
      dataIndex: 'options',
      render: (options: DictionaryItem['options']) => (
        <Space wrap size={[4, 4]}>
          {(options || []).map((item) => <Tag key={item.value} color={item.enabled ? 'blue' : 'default'}>{item.label}</Tag>)}
        </Space>
      ),
    },
  ];

  const fieldColumns = [
    { title: '字段名称', dataIndex: 'label', width: 140 },
    { title: '字段编码', dataIndex: 'name', width: 160 },
    { title: '字段类型', dataIndex: 'type', width: 120 },
    { title: '引用角色', dataIndex: 'role', render: (value: string) => <Tag color="cyan">{value}</Tag> },
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card loading={loading}>
        <Row gutter={[16, 16]} align="middle">
          <Col flex="auto">
            <Space direction="vertical" size={2}>
              <Typography.Text type="secondary">
                维护可复用的字典条目与基础档案。
              </Typography.Text>
            </Space>
          </Col>
          <Col>
            <Segmented
              value={mode}
              onChange={(value) => setMode(value as 'dictionary' | 'master')}
              options={[
                { label: '数据字典', value: 'dictionary', icon: <TagsOutlined /> },
                { label: '基础档案', value: 'master', icon: <ProfileOutlined /> },
              ]}
            />
          </Col>
        </Row>
      </Card>

      {mode === 'dictionary' ? (
        <Card
          title={<Space><TagsOutlined />数据字典</Space>}
          extra={<Button type="primary" icon={<PlusOutlined />} loading={saving} onClick={() => setDictionaryOpen(true)}>新建字典</Button>}
        >
          <Table
            rowKey="id"
            columns={dictionaryColumns}
            dataSource={dictionaries}
            loading={loading}
            pagination={false}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="数据库中暂无数据字典" /> }}
          />
        </Card>
      ) : (
        <Row gutter={16}>
          <Col span={7}>
            <Card title={<Space><DatabaseOutlined />档案类型</Space>} extra={<Button size="small" icon={<PlusOutlined />} loading={saving} onClick={() => setMasterOpen(true)}>新建</Button>}>
              {masterData.length ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {masterData.map((item) => (
                    <Button
                      key={item.id}
                      block
                      type={item.id === selectedMasterId ? 'primary' : 'default'}
                      icon={item.id === selectedMasterId ? <ApartmentOutlined /> : <DatabaseOutlined />}
                      onClick={() => setSelectedMasterId(item.id)}
                      style={{ justifyContent: 'flex-start' }}
                    >
                      {item.name}
                    </Button>
                  ))}
                </Space>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="数据库中暂无基础档案" />}
            </Card>
          </Col>
          <Col span={17}>
            <Card
              title={selectedMaster?.name || '基础档案'}
              extra={selectedMaster?.code ? <Tag color="blue">{selectedMaster.code}</Tag> : null}
            >
              {selectedMaster ? (
                <>
                  <Typography.Paragraph type="secondary">{selectedMaster.description}</Typography.Paragraph>
                  <SettingsTabs
                    items={[
                      {
                        key: 'fields',
                        label: '字段定义',
                        children: <Table rowKey="name" columns={fieldColumns} dataSource={selectedMaster.fields || []} pagination={false} />,
                      },
                      {
                        key: 'records',
                        label: '档案数据',
                        children: <Table rowKey={(row) => Object.values(row).join('-')} columns={recordColumns} dataSource={selectedMaster.records || []} pagination={false} />,
                      },
                      {
                        key: 'usage',
                        label: '表单引用',
                        children: (
                          <Space direction="vertical">
                            <Typography.Text>引用对象：{selectedMaster.name}</Typography.Text>
                            <Typography.Text>引用编码：{selectedMaster.code}</Typography.Text>
                            <Typography.Text type="secondary">字段和记录来自数据库保存的档案配置。</Typography.Text>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择或创建基础档案" />}
            </Card>
          </Col>
        </Row>
      )}

      <Modal title="新建数据字典" open={dictionaryOpen} onCancel={() => setDictionaryOpen(false)} onOk={addDictionary} okText="保存" confirmLoading={saving}>
        <Form layout="vertical" form={dictionaryForm}>
          <Form.Item label="字典名称" name="dictName" rules={[{ required: true, message: '请输入字典名称' }]}>
            <Input placeholder="例如：告警等级" />
          </Form.Item>
          <Form.Item label="字典编码" name="dictCode" rules={[{ required: true, message: '请输入字典编码' }]}>
            <Input placeholder="例如：alert_level" />
          </Form.Item>
          <Form.Item label="适用范围" name="scope">
            <Input placeholder="例如：告警中心 / 通用" />
          </Form.Item>
          <Form.Item label="维护方" name="owner">
            <Input placeholder="例如：系统管理" />
          </Form.Item>
          <Form.Item label="选项值" name="options" rules={[{ required: true, message: '请输入选项' }]}>
            <Input.TextArea rows={3} placeholder="用顿号、逗号或换行分隔，例如：严重、一般、提醒" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="新建基础档案类型" open={masterOpen} onCancel={() => setMasterOpen(false)} onOk={addMaster} okText="保存" confirmLoading={saving}>
        <Form layout="vertical" form={masterForm}>
          <Form.Item label="档案名称" name="name" rules={[{ required: true, message: '请输入档案名称' }]}>
            <Input placeholder="例如：设备档案" />
          </Form.Item>
          <Form.Item label="档案编码" name="code" rules={[{ required: true, message: '请输入档案编码' }]}>
            <Input placeholder="例如：equipment_master" />
          </Form.Item>
          <Form.Item label="维护方" name="owner">
            <Input placeholder="例如：设备管理" />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} placeholder="说明这个档案给哪些表单复用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
