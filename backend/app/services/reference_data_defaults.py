"""Additive reference-data setup. Existing codes, labels and disabled values win."""
from copy import deepcopy


# Stable machine values are separate from the labels shown in forms.
DICTIONARIES = [
    ('yes_no', '是否', '通用', [('yes', '是'), ('no', '否')]),
    ('status', '启用状态', '通用', [('active', '启用'), ('inactive', '停用')]),
    ('priority', '优先级', '通用', [('low', '低'), ('normal', '普通'), ('high', '高'), ('urgent', '紧急')]),
    ('document_status', '单据状态', '通用', [('draft', '草稿'), ('pending', '待处理'), ('in_progress', '处理中'), ('completed', '已完成'), ('cancelled', '已取消')]),
    ('approval_status', '审批状态', '流程', [('draft', '草稿'), ('pending', '待审批'), ('approved', '已通过'), ('rejected', '已驳回'), ('withdrawn', '已撤回')]),
    ('unit', '计量单位', '通用', [(v, v) for v in ['个', '件', '套', '台', '箱', '包', '卷', '张', '支', '根', '瓶', '袋', '批', 'kg', 'g', 't', 'm', 'cm', 'mm', 'm²', 'm³', 'L', 'mL', '小时']]),
    ('currency', '币种', '采购', [('CNY', '人民币'), ('USD', '美元'), ('EUR', '欧元'), ('JPY', '日元'), ('HKD', '港币'), ('GBP', '英镑')]),
    ('material_type', '物料类别', '物料', [('raw_material', '原材料'), ('semi_finished', '半成品'), ('finished_product', '成品'), ('auxiliary', '辅料'), ('packaging', '包装材料'), ('spare_part', '备品备件'), ('production', '生产物料')]),
    ('equipment_status', '设备状态', '设备', [('running', '运行中'), ('idle', '空闲'), ('maintenance', '维护中'), ('fault', '故障'), ('offline', '离线')]),
    ('production_line_status', '产线状态', '生产', [('running', '运行中'), ('idle', '空闲'), ('maintenance', '维护中'), ('stopped', '已停线')]),
    ('work_order_status', '生产工单状态', '生产', [('planned', '已计划'), ('in_progress', '生产中'), ('completed', '已完成'), ('cancelled', '已取消')]),
    ('shift', '班次', '生产', [('day', '白班'), ('middle', '中班'), ('night', '夜班')]),
    ('inspection_type', '检验类型', '质量', [('incoming', '来料检验'), ('in_process', '过程检验'), ('final', '最终检验')]),
    ('inspection_result', '检验结果', '质量', [('pending', '待检验'), ('pass', '合格'), ('fail', '不合格')]),
    ('defect_severity', '缺陷严重程度', '质量', [('minor', '轻微'), ('major', '主要'), ('critical', '严重')]),
    ('risk_level', '风险等级', '质量', [('low', '低风险'), ('medium', '中风险'), ('high', '高风险'), ('critical', '重大风险')]),
    ('alert_source', '告警来源', '告警', [('equipment', '设备'), ('sensor', '传感器'), ('production', '生产'), ('quality', '质量'), ('inventory', '库存'), ('system', '系统')]),
    ('alert_level', '告警等级', '告警', [('info', '提示'), ('warning', '预警'), ('high', '高'), ('critical', '严重')]),
    ('alert_status', '告警状态', '告警', [('pending', '待处理'), ('acknowledged', '已确认'), ('in_progress', '处理中'), ('resolved', '已解决'), ('closed', '已关闭')]),
    ('maintenance_type', '维护类型', '设备', [('preventive', '预防性维护'), ('corrective', '故障维修'), ('predictive', '预测性维护'), ('inspection', '日常点检')]),
    ('maintenance_status', '维修工单状态', '设备', [('pending', '待处理'), ('assigned', '已派工'), ('in_progress', '维修中'), ('completed', '已完成'), ('cancelled', '已取消')]),
    ('shipment_status', '物流状态', '供应链', [('pending', '待发运'), ('in_transit', '运输中'), ('delivered', '已送达'), ('delayed', '已延误')]),
    ('purchase_status', '采购单状态', '采购', [('draft', '草稿'), ('pending', '待审批'), ('approved', '已审批'), ('ordered', '已下单'), ('partially_received', '部分到货'), ('received', '已到货'), ('closed', '已关闭'), ('cancelled', '已取消')]),
    ('inventory_action', '库存业务类型', '仓储', [('purchase_receipt', '采购入库'), ('production_receipt', '生产入库'), ('production_issue', '生产领料'), ('sales_issue', '销售出库'), ('transfer', '调拨'), ('return', '退料'), ('adjustment', '盘点调整')]),
]


def default_dictionaries():
    return [dict(id=f'builtin-dict-{code}', dictCode=code, dictName=name,
                 scope=scope, owner='系统管理', options=[
                     {'label': label, 'value': value, 'enabled': True} for value, label in options])
            for code, name, scope, options in DICTIONARIES]


def merge_reference_data(existing, masters):
    """Only add missing dictionary values, fields and source-record IDs."""
    result = deepcopy(existing or {})
    for collection, defaults, code_key in [
        ('dictionaries', default_dictionaries(), 'dictCode'),
        ('masterData', masters, 'code'),
    ]:
        items = result.setdefault(collection, [])
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            raise ValueError(f'{collection} 配置格式无效')
        codes = [item.get(code_key) for item in items]
        if len(codes) != len(set(codes)):
            raise ValueError(f'{collection} 存在重复编码，请先处理')
        indexed = {item.get(code_key): item for item in items}
        for default in defaults:
            current = indexed.get(default[code_key])
            if current is None:
                items.append(deepcopy(default))
                continue
            children = [('options', 'value')] if collection == 'dictionaries' else [('fields', 'name'), ('records', 'id')]
            for child, identity in children:
                values = current.setdefault(child, [])
                if not isinstance(values, list) or any(not isinstance(value, dict) for value in values):
                    raise ValueError(f'{default[code_key]}.{child} 配置格式无效')
                seen = {str(value.get(identity)) for value in values}
                for value in default.get(child, []):
                    if str(value[identity]) not in seen:
                        values.append(deepcopy(value))
                        seen.add(str(value[identity]))
    return result


async def existing_master_data(db, tenant_id):
    """Expose existing tenant business rows, never invent companies or equipment."""
    from sqlalchemy import select
    from app.models.relational import Material, Supplier, Equipment, ProductionLine
    specs = [
        (Material, 'material_master', '物料档案', [('id', '内部 ID', 'integer'), ('name', '物料名称', 'string'), ('material_type', '物料类别', 'string'), ('specs', '规格型号', 'string'), ('unit', '计量单位', 'string')]),
        (Supplier, 'supplier_master', '供应商档案', [('id', '内部 ID', 'integer'), ('name', '供应商名称', 'string'), ('location', '地区', 'string'), ('rating', '评级分值', 'number'), ('lead_time_days', '交货周期（天）', 'integer')]),
        (Equipment, 'equipment', '设备档案', [('id', '内部 ID', 'integer'), ('name', '设备名称', 'string'), ('model', '型号', 'string'), ('manufacturer', '制造商', 'string'), ('status', '状态', 'string'), ('line_id', '所属产线 ID', 'integer')]),
        (ProductionLine, 'production_lines', '产线档案', [('id', '内部 ID', 'integer'), ('name', '产线名称', 'string'), ('workshop_id', '车间 ID', 'integer'), ('status', '状态', 'string'), ('capacity', '产能', 'number')]),
    ]
    result = []
    for model, code, name, fields in specs:
        rows = (await db.scalars(select(model).where(model.tenant_id == tenant_id).order_by(model.id))).all()
        result.append(dict(id=f'builtin-master-{code}', code=code, name=name, owner='系统管理',
            description='从当前租户已有业务数据初始化的档案快照；表单关联继续读取业务源表。原记录中的示例标记予以保留。',
            fields=[{'name': key, 'label': label, 'type': kind, 'role': '主键' if key == 'id' else '显示名称' if key == 'name' else '业务属性'} for key, label, kind in fields],
            records=[{key: '' if getattr(row, key) is None else str(getattr(row, key)) for key, _, _ in fields} for row in rows]))
    return result
