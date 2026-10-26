"""Read structured static options while retaining legacy delimited lists."""
import json
import re


def parse_options(source):
    if source is None:
        return []
    if not isinstance(source, str):
        raise ValueError('静态选项格式无效')
    if not source.strip():
        return []
    try:
        raw = json.loads(source)
    except json.JSONDecodeError:
        return [item.strip() for item in re.split(r'[、,/，|\n]', source) if item.strip()]
    if not isinstance(raw, list):
        raise ValueError('静态选项需要选项数组')
    result = []
    for item in raw:
        if isinstance(item, (str, int, float)) and not isinstance(item, bool):
            result.append(item)
        elif isinstance(item, dict) and isinstance(item.get('value'), (str, int, float)) and not isinstance(item['value'], bool) and isinstance(item.get('label'), str):
            result.append({'label': item['label'], 'value': item['value']})
        else:
            raise ValueError('静态选项的显示名称或存储值格式无效')
    return result


def option_errors(choices):
    errors = []
    if not choices:
        errors.append('请至少添加一个选项')
    seen = set()
    for index, item in enumerate(choices, 1):
        value = item['value'] if isinstance(item, dict) else item
        label = item['label'] if isinstance(item, dict) else str(item)
        key = str(value).strip()
        if not label.strip() or not key:
            errors.append(f'第 {index} 项缺少显示名称或存储值')
        if key in seen:
            errors.append(f'第 {index} 项存储值重复：{key}')
        seen.add(key)
    return errors
