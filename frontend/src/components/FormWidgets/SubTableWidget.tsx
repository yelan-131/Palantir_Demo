import { useEffect, useState } from 'react';
import { Table, Button, Input, InputNumber, Select, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { getChildren, createModelData, updateModelData, deleteModelData } from '@/services/api';

interface ColumnDef {
  field_name: string;
  label: string;
  field_type: string;
  editable?: boolean;
}

interface Props {
  parentModel: string;
  parentId: number | null;
  childTable: string;
  columns: ColumnDef[];
  fkField: string;
}

export default function SubTableWidget({ parentModel, parentId, childTable, columns, fkField }: Props) {
  const [data, setData] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});

  const loadData = async () => {
    if (!parentId) return;
    setLoading(true);
    try {
      const res = await getChildren(parentModel, parentId, childTable);
      setData(res.data?.data || []);
    } catch {
      message.error('加载子表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [parentId]);

  const handleAdd = async () => {
    if (!parentId) return;
    const newRow: Record<string, any> = { [fkField]: parentId };
    try {
      await createModelData(childTable, newRow);
      message.success('已添加');
      loadData();
    } catch {
      message.error('添加失败');
    }
  };

  const handleSave = async (record: Record<string, any>) => {
    try {
      await updateModelData(childTable, record.id, editValues);
      setEditingKey(null);
      setEditValues({});
      message.success('已保存');
      loadData();
    } catch {
      message.error('保存失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteModelData(childTable, id);
      message.success('已删除');
      loadData();
    } catch {
      message.error('删除失败');
    }
  };

  const startEdit = (record: Record<string, any>) => {
    setEditingKey(record.id);
    setEditValues({ ...record });
  };

  const tableColumns: any[] = columns
    .filter((c) => c.editable !== false)
    .map((col) => ({
      title: col.label,
      dataIndex: col.field_name,
      key: col.field_name,
      render: (val: any, record: Record<string, any>) => {
        if (editingKey === record.id) {
          if (col.field_type === 'int' || col.field_type === 'float') {
            return <InputNumber size="small" value={editValues[col.field_name]} onChange={(v) => setEditValues({ ...editValues, [col.field_name]: v })} style={{ width: '100%' }} />;
          }
          if (col.field_type === 'enum') {
            return <Input size="small" value={editValues[col.field_name]} onChange={(e) => setEditValues({ ...editValues, [col.field_name]: e.target.value })} />;
          }
          return <Input size="small" value={editValues[col.field_name]} onChange={(e) => setEditValues({ ...editValues, [col.field_name]: e.target.value })} />;
        }
        return String(val ?? '');
      },
    }));

  tableColumns.push({
    title: '操作',
    key: '_action',
    width: 100,
    render: (_: any, record: Record<string, any>) => (
      <Space size={4}>
        {editingKey === record.id ? (
          <Button size="small" type="link" icon={<SaveOutlined />} onClick={() => handleSave(record)}>保存</Button>
        ) : (
          <Button size="small" type="link" onClick={() => startEdit(record)}>编辑</Button>
        )}
        <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
          <Button size="small" type="link" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    ),
  });

  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 500, fontSize: 13 }}>子表数据 ({data.length})</span>
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={handleAdd} disabled={!parentId}>
          添加行
        </Button>
      </div>
      <Table
        dataSource={data}
        columns={tableColumns}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
        scroll={{ y: 200 }}
      />
    </div>
  );
}
