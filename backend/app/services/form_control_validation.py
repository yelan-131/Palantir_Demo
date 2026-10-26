"""Validation and normalization for designer controls, shared by every record writer."""
import math
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from fastapi import HTTPException


def normalize(value, rules):
    if not isinstance(value,str): return value
    if rules.get('trimMode')=='trim': value=value.strip()
    elif rules.get('trimMode') in {'trimAll','removeAll'}: value=re.sub(r'\s','',value)
    if rules.get('caseMode')=='upper': value=value.upper()
    elif rules.get('caseMode')=='lower': value=value.lower()
    return value


def validate(value, field, *, partial=False):
    ui=getattr(field,'ui_config',None) or {};rules=ui.get('typeSettings') or {};label=field.label or field.field_name
    def fail(detail): raise HTTPException(422,f'字段「{label}」{detail}')
    if ui.get('controlType')=='select':
        multiple=rules.get('selectionMode')=='multiple' or rules.get('displayMode')=='tags'
        if multiple:
            count = len(value) if isinstance(value, list) else 0
            if not partial and count < int(rules.get('minSelections') or 0): fail(f'至少选择 {rules["minSelections"]} 项')
            if rules.get('maxSelections') is not None and count > int(rules['maxSelections']): fail(f'最多选择 {rules["maxSelections"]} 项')
        if value in (None, ''): return
        if multiple and not isinstance(value,list): fail('多选数据必须为数组')
        values=value if multiple else [value]
        if any(not isinstance(item,(str,int,float)) or isinstance(item,bool) for item in values): fail('选项值格式不正确')
        if multiple and len({str(item) for item in values}) != len(values): fail('不能重复选择同一选项')
    if value in (None, ''): return
    if isinstance(value,str):
        if len(value)<int(rules.get('minLength') or 0): fail('字符数不足')
        if rules.get('maxLength') is not None and len(value)>int(rules['maxLength']): fail('超过最大字符数')
        patterns={'email':r'[^\s@]+@[^\s@]+\.[^\s@]+','phone':r'\+?[0-9 ()-]{6,20}','url':r'https?://[^\s]+','idNo':r'[0-9A-Za-z-]{6,30}'}
        pattern=patterns.get(rules.get('textFormat'))
        if pattern and not re.fullmatch(pattern,value): fail('格式不正确')
    if isinstance(value,(int,float)) and not isinstance(value,bool):
        if not math.isfinite(value): fail('必须为有限数值')
        if rules.get('min') is not None and value<rules['min']: fail(f'不能小于 {rules["min"]}')
        if rules.get('max') is not None and value>rules['max']: fail(f'不能大于 {rules["max"]}')
        if rules.get('precision') is not None:
            try: places=max(0,-Decimal(str(value)).normalize().as_tuple().exponent)
            except InvalidOperation: fail('数值无效')
            if places>int(rules['precision']): fail(f'最多允许 {rules["precision"]} 位小数')
    if ui.get('controlType')=='datetime':
        values=value if isinstance(value,list) else [value]
        try:
            if rules.get('dateMode')=='range' and (not isinstance(value,list) or len(value)!=2): fail('日期范围需要起止两个日期')
            parsed=[date.fromisoformat(str(item)[:10]) for item in values]
            if rules.get('dateMode')=='range' and parsed[0]>parsed[1]: fail('开始日期不能晚于结束日期')
            if rules.get('disablePast') and any(item<date.today() for item in parsed): fail('不能选择过去的日期')
        except (ValueError,TypeError): fail('日期格式无效')
    if ui.get('controlType')=='editable-table':
        columns=rules.get('columns') or []
        if not isinstance(value,list): fail('明细数据必须为数组')
        if len(value)>int(rules.get('maxRows') or 200): fail('明细行数超过上限')
        if not partial and len(value)<int(rules.get('minRows') or 0): fail('明细行数不足')
        allowed={column['key'] for column in columns}
        for row in value:
            if not isinstance(row,dict) or set(row)-allowed: fail('明细列不符合配置')
            for column in columns:
                item=row.get(column['key'])
                if not partial and column.get('required') and item in (None,''): fail(f'明细列「{column["label"]}」不能为空')
                if item in (None,''): continue
                if column['type']=='number' and (not isinstance(item,(int,float)) or isinstance(item,bool)): fail('明细数值列类型不正确')
                if column['type']=='boolean' and not isinstance(item,bool): fail('明细布尔列类型不正确')
                if column['type']=='string' and not isinstance(item,str): fail('明细文本列类型不正确')


def design_errors(config, fields):
    """Block ambiguous bindings or settings that cannot be stored by their field."""
    from app.services.form_calculations import design_errors as calculation_errors
    errors=calculation_errors(fields);seen=set();by_name={field['field_name']:field for field in fields}
    from app.services.field_limits import DEFAULT_FORM_FIELDS
    if sum(not field.get('archived') for field in fields) > DEFAULT_FORM_FIELDS:
        errors.append(f'表单字段数量不能超过系统上限 {DEFAULT_FORM_FIELDS} 个')
    from app.services.option_search import validate as validate_search
    for control in config.get('formDesignerControls') or []:
        if not isinstance(control, dict): continue
        try: validate_search((control.get('typeSettings') or {}).get('search') or {}, context_fields=set(by_name))
        except HTTPException as exc: errors.append(str(exc.detail))
    from app.services.form_defaults import rule_errors
    defaults = {field['field_name']: (field.get('ui_config') or {}).get('defaultRule') for field in fields}
    for control in config.get('formDesignerControls') or []:
        if isinstance(control, dict) and control.get('fieldKey') in by_name and 'defaultRule' in control:
            defaults[control['fieldKey']] = control['defaultRule']
    dependencies = {}
    for name, rule in defaults.items():
        if rule is None: continue
        found = rule_errors(rule, by_name, name)
        errors.extend(f'「{name}」{message}' for message in found)
        if found or rule.get('enabled') is False: continue
        condition_references = [condition['sourceField'] for condition in rule.get('conditions', [])]
        dependencies[name] = condition_references
        if rule.get('mode') != 'template': continue
        if by_name[name].get('field_type') not in {'string', 'text', 'code'}:
            errors.append(f'「{name}」拼接默认值需要文本字段')
        if (by_name[name].get('ui_config') or {}).get('computed'):
            errors.append(f'「{name}」计算字段不能同时配置拼接默认值')
        references = [part['value'] for part in rule['parts'] if part['kind'] == 'field']
        if any(by_name[source].get('field_type') == 'json' or (by_name[source].get('ui_config') or {}).get('computed') for source in references):
            errors.append(f'「{name}」默认值请引用普通字段，不支持明细或计算字段')
        dependencies[name] = references + condition_references
    visited, visiting = set(), set()
    def visit_default(name):
        if name in visiting:
            errors.append('默认值拼接存在循环引用'); return
        if name in visited: return
        visiting.add(name)
        for source in dependencies.get(name, []): visit_default(source)
        visiting.remove(name); visited.add(name)
    for name in dependencies: visit_default(name)
    supported={'field','text','textarea','readonly-text','code','number','select','relation','datetime','upload','switch','editable-table','readonly-table'}
    for control in config.get('formDesignerControls') or []:
        if not isinstance(control,dict): continue
        kind=control.get('controlType');key=control.get('fieldKey');label=control.get('name') or key or '控件'
        if kind in {'container','two-columns','tabs','divider'}: continue
        if not key or key not in by_name: errors.append(f'「{label}」请绑定有效存储字段');continue
        if key in seen: errors.append(f'字段「{key}」重复绑定，请为复制控件重新选择字段')
        seen.add(key)
        field=by_name[key];storage=field.get('field_type');rules=control.get('typeSettings') or {}
        if control.get('dataSourceKind') in {'externalApi','dictionary'} and not control.get('optionSource'):errors.append(f'「{label}」请选择有效数据来源')
        if control.get('dataSourceKind') in {'externalApi','dictionary'} and (rules.get('selectionMode')=='multiple' or rules.get('displayMode') in {'tags','radio','checkbox'}):errors.append(f'「{label}」引用数据源目前支持单选下拉或搜索；请调整选择模式')
        effective_kind = kind
        if kind == 'field':
            effective_kind = 'select' if field.get('business_type') == 'enum' or storage == 'enum' else (field.get('ui_config') or {}).get('controlType')
        if effective_kind in {'select', 'relation'}:
            source_kind = control.get('dataSourceKind', 'static' if effective_kind == 'select' else 'masterData')
            multiple = rules.get('selectionMode') == 'multiple'
            display = rules.get('displayMode', 'dropdown')
            if rules.get('selectionMode', 'single') not in {'single', 'multiple'} or display not in {'dropdown', 'search', 'radio', 'tags'}:
                errors.append(f'「{label}」选择模式或展示方式无效')
            if display == 'tags' and not multiple:
                errors.append(f'「{label}」标签展示需要多选模式')
            if source_kind != 'static' and (multiple or display not in {'dropdown', 'search'} or rules.get('allowCreateOption')):
                errors.append(f'「{label}」引用数据源仅支持单选下拉或搜索')
            if rules.get('allowCreateOption') and (not multiple or display == 'radio'):
                errors.append(f'「{label}」当前模式不支持临时项')
            if multiple or display == 'tags':
                for setting, title, lower in [('minSelections', '最少选择', 0), ('maxSelections', '最多选择', 1), ('maxVisibleTags', '显示标签数', 1)]:
                    number = rules.get(setting)
                    if number is not None and (isinstance(number, bool) or not isinstance(number, int) or not lower <= number <= 1000):
                        errors.append(f'「{label}」{title}需要是 {lower}～1000 的整数')
                minimum, maximum = rules.get('minSelections'), rules.get('maxSelections')
                if isinstance(minimum, int) and isinstance(maximum, int) and minimum > maximum:
                    errors.append(f'「{label}」最少选择不能大于最多选择')
                if rules.get('tagCollapse', 'none') not in {'none', 'responsive', 'fixed'}:
                    errors.append(f'「{label}」标签折叠方式无效')
            if source_kind == 'static':
                from app.services.static_options import parse_options, option_errors
                try:
                    raw = field.get('enum_values') or {}
                    choices = parse_options(control['optionSource']) if 'optionSource' in control else raw.get('values', raw) if isinstance(raw, dict) else raw
                    if isinstance(choices, dict): choices = [{'value': key, 'label': str(value)} for key, value in choices.items()]
                    errors.extend(f'「{label}」{error}' for error in option_errors(choices))
                    if multiple and not rules.get('allowCreateOption') and isinstance(rules.get('minSelections'), int) and rules['minSelections'] > len(choices): errors.append(f'「{label}」最少选择不能超过候选选项数量')
                    default = field.get('default_value')
                    rule = control.get('defaultRule', (field.get('ui_config') or {}).get('defaultRule')) or {}
                    if rule.get('enabled') is not False and rule.get('mode') != 'template' and default not in (None, ''):
                        import json
                        values = [default]
                        if multiple and isinstance(default, str):
                            try:
                                parsed = json.loads(default)
                                values = parsed if isinstance(parsed, list) else [parsed]
                            except ValueError: pass
                        allowed = {str(item['value'] if isinstance(item, dict) else item) for item in choices}
                        if multiple:
                            minimum, maximum = rules.get('minSelections'), rules.get('maxSelections')
                            if isinstance(minimum, int) and len(values) < minimum: errors.append(f'「{label}」默认值至少选择 {minimum} 项')
                            if isinstance(maximum, int) and len(values) > maximum: errors.append(f'「{label}」默认值最多选择 {maximum} 项')
                        if not rules.get('allowCreateOption') and any(str(value) not in allowed for value in values): errors.append(f'「{label}」默认值不在候选选项中')
                except (ValueError, TypeError, KeyError) as exc:
                    errors.append(f'「{label}」静态选项配置无效：{exc}')
        if kind not in supported: errors.append(f'「{label}」控件尚不支持发布');continue
        if kind in {'upload','editable-table','readonly-table'} and storage!='json': errors.append(f'「{label}」需要绑定 JSON 字段')
        if storage=='date' and rules.get('dateMode') in {'datetime','range'}: errors.append(f'「{label}」日期字段仅支持日期模式，时间或范围需要新建对应类型字段')
        if rules.get('dateMode')=='range' and storage!='json': errors.append(f'「{label}」日期范围需要绑定 JSON 字段')
        if kind=='number' and storage not in {'int','integer','float','number','decimal'}: errors.append(f'「{label}」数值控件需要数值字段')
        if kind=='switch' and storage!='boolean': errors.append(f'「{label}」开关需要布尔字段')
        if rules.get('selectionMode')=='multiple' and storage not in {'enum','json'}: errors.append(f'「{label}」多选需要枚举或 JSON 字段')
        for name,low,high in [('minLength',0,1000000),('maxLength',0,1000000),('precision',0,6),('rows',1,20),('maxFiles',1,20),('maxFileSize',1,200),('minRows',0,200),('maxRows',1,200)]:
            value=rules.get(name)
            if value is not None and (isinstance(value,bool) or not isinstance(value,int) or not low<=value<=high): errors.append(f'「{label}」{name} 配置无效')
        for lower,upper in [('min','max'),('minLength','maxLength'),('minRows','maxRows')]:
            a,b=rules.get(lower),rules.get(upper)
            if lower=='min':
                if any(v is not None and (isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v)) for v in [a,b]): errors.append(f'「{label}」数值范围无效');continue
            if a is not None and b is not None and isinstance(a,(int,float)) and isinstance(b,(int,float)) and a>b: errors.append(f'「{label}」最小值不能大于最大值')
        if kind in {'editable-table','readonly-table'}:
            columns=rules.get('columns') or [];keys=set()
            if not columns or len(columns)>50: errors.append(f'「{label}」请配置 1～50 个明细列')
            for column in columns:
                if not isinstance(column,dict) or not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]{0,63}',str(column.get('key',''))) or not column.get('label') or column.get('type') not in {'string','number','boolean'}: errors.append(f'「{label}」明细列配置无效');continue
                if column['key'] in keys: errors.append(f'「{label}」明细列编码重复')
                keys.add(column['key'])
            if kind=='readonly-table' and (not isinstance(rules.get('sourceFormId'),int) or rules['sourceFormId']<1): errors.append(f'「{label}」请配置有效来源表单 ID')
    writers={};dependencies={}
    for field in fields:
        if (field.get('ui_config') or {}).get('assignmentRulesEnabled') is False: continue
        for assignment in (field.get('ui_config') or {}).get('assignmentRules') or []:
            target=assignment.get('targetField');attr=str(assignment.get('sourceAttribute') or '')
            if target not in by_name or attr not in {'self.value','self.option_value','self.option_label'} and not attr.startswith('record.'):
                errors.append('赋值规则需要有效的来源属性和目标字段');continue
            if target in writers:errors.append(f'「{target}」存在多个赋值来源')
            writers[target]=field['field_name'];dependencies[target]=field['field_name']
            target_ui=by_name[target].get('ui_config') or {}
            if target_ui.get('relation_config') or target_ui.get('computed'):errors.append(f'「{target}」关联或计算字段不能再作为赋值目标')
            if isinstance(defaults.get(target), dict) and defaults[target].get('mode') == 'template' and defaults[target].get('enabled') is not False:errors.append(f'「{target}」不能同时配置赋值与拼接默认值')
    for target in dependencies:
        visiting=set();current=target
        while current in dependencies:
            if current in visiting:errors.append('字段赋值存在循环依赖');break
            visiting.add(current);current=dependencies[current]
    return errors
