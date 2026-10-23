"""Bounded formula language shared by designer validation and record writes."""
import ast
from decimal import Decimal, DecimalException, ROUND_HALF_UP, localcontext

from fastapi import HTTPException

FUNCTIONS = {'IF': (3, 3), 'ROUND': (1, 2), 'ABS': (1, 1), 'MIN': (1, 20), 'MAX': (1, 20), 'COALESCE': (1, 20)}


def fail(message):
    raise HTTPException(422, f'计算公式：{message}')


def expression_tree(expression):
    if not isinstance(expression, str) or not expression.strip() or len(expression) > 4096:
        fail('请填写有效公式（最多 4096 个字符）')
    try:
        tree = ast.parse(expression, mode='eval')
    except (SyntaxError, ValueError, RecursionError):
        fail('语法无效，请检查括号和运算符')
    nodes = list(ast.walk(tree))
    if len(nodes) > 100:
        fail('公式过于复杂，请拆分为多个计算字段')
    allowed = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod,
               ast.UAdd, ast.USub, ast.Name, ast.Load, ast.Constant, ast.Call, ast.Compare,
               ast.Eq, ast.NotEq, ast.Gt, ast.GtE, ast.Lt, ast.LtE)
    for node in nodes:
        if not isinstance(node, allowed):
            fail('仅支持字段、常量、加减乘除、比较和内置函数')
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS or node.keywords:
                fail('仅支持 IF、ROUND、ABS、MIN、MAX、COALESCE 函数及位置参数')
            low, high = FUNCTIONS[node.func.id]
            if not low <= len(node.args) <= high:
                fail(f'{node.func.id} 参数数量不正确')
        if isinstance(node, ast.Constant) and (isinstance(node.value, bool) or not isinstance(node.value, (str, int, float))):
            fail('常量只能是文字或数值')
    return tree


def references(tree):
    functions = {id(node.func) for node in ast.walk(tree) if isinstance(node, ast.Call)}
    return {node.id for node in ast.walk(tree) if isinstance(node, ast.Name) and id(node) not in functions}


def validate_rule(rule):
    if not isinstance(rule, dict):
        fail('配置必须为对象')
    precision = rule.get('precision')
    if precision is not None and (type(precision) is not int or not 0 <= precision <= 6):
        fail('小数位数应为 0～6 的整数')
    if rule.get('emptyBehavior', 'empty') not in {'empty', 'zero'}:
        fail('空值处理配置无效')
    return expression_tree(rule.get('expression'))


def compute(tree, data, rule=None):
    rule = rule or {}

    def number(value):
        if isinstance(value, bool) or not isinstance(value, (Decimal, int, float)):
            fail('算术运算需要数值字段，请检查来源字段类型')
        try:
            result = Decimal(str(value))
        except DecimalException:
            fail('数值无效')
        if not result.is_finite() or abs(result) > Decimal('1e30'):
            fail('数值超出计算范围')
        return result

    def rounded(value, digits):
        digits = number(digits)
        if digits != digits.to_integral_value() or not 0 <= digits <= 6:
            fail('ROUND 小数位数应为 0～6 的整数')
        return number(value).quantize(Decimal(1).scaleb(-int(digits)), rounding=ROUND_HALF_UP)

    def visit(node):
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Name):
            value = data.get(node.id)
            return (Decimal(0) if rule.get('emptyBehavior') == 'zero' else None) if value is None or value == '' else value
        if isinstance(node, ast.Constant):
            return node.value if isinstance(node.value, str) else number(node.value)
        if isinstance(node, ast.Call):
            name = node.func.id
            if name == 'IF':
                condition = visit(node.args[0])
                return None if condition is None else visit(node.args[1] if bool(condition) else node.args[2])
            if name == 'COALESCE':
                for argument in node.args:
                    value = visit(argument)
                    if value is not None and value != '':
                        return value
                return None
            values = [visit(arg) for arg in node.args]
            if any(value is None for value in values):
                return None
            if name == 'ROUND':
                return rounded(values[0], values[1] if len(values) > 1 else 0)
            numbers = [number(value) for value in values]
            return abs(numbers[0]) if name == 'ABS' else min(numbers) if name == 'MIN' else max(numbers)
        if isinstance(node, ast.UnaryOp):
            value = visit(node.operand)
            return None if value is None else number(value) * (-1 if isinstance(node.op, ast.USub) else 1)
        if isinstance(node, ast.BinOp):
            left, right = visit(node.left), visit(node.right)
            if left is None or right is None:
                return None
            if isinstance(node.op, ast.Add) and (isinstance(left, str) or isinstance(right, str)):
                result = str(left) + str(right)
                if len(result.encode('utf-8')) > 65536:
                    fail('文字结果过长')
                return result
            left, right = number(left), number(right)
            if isinstance(node.op, (ast.Div, ast.Mod)) and not right:
                fail('除数不能为 0')
            if isinstance(node.op, ast.Add): return number(left + right)
            if isinstance(node.op, ast.Sub): return number(left - right)
            if isinstance(node.op, ast.Mult): return number(left * right)
            if isinstance(node.op, ast.Div): return number(left / right)
            return number(left % right)
        if isinstance(node, ast.Compare):
            left = visit(node.left)
            for operator, operand in zip(node.ops, node.comparators):
                right = visit(operand)
                if left is None or right is None: return None
                if not isinstance(left, str) or not isinstance(right, str):
                    left, right = number(left), number(right)
                result = (left == right if isinstance(operator, ast.Eq) else left != right if isinstance(operator, ast.NotEq)
                    else left > right if isinstance(operator, ast.Gt) else left >= right if isinstance(operator, ast.GtE)
                    else left < right if isinstance(operator, ast.Lt) else left <= right)
                if not result: return False
                left = right
            return True
        fail('不支持的运算')

    try:
        with localcontext() as context:
            context.prec = 40
            result = visit(tree)
            if result is None or isinstance(result, str): return result
            if isinstance(result, bool): fail('最终结果应为数值或文字，请使用 IF 返回计算结果')
            result = number(result)
            if rule.get('precision') is not None: result = rounded(result, rule['precision'])
            return int(result) if result == result.to_integral_value() else float(result)
    except DecimalException:
        fail('计算结果超出范围，请检查公式和来源数值')


def design_errors(fields):
    by_name = {field['field_name']: field for field in fields}
    dependencies = {}
    errors = []
    for name, field in by_name.items():
        rule = (field.get('ui_config') or {}).get('computed')
        if not rule: continue
        try:
            dependencies[name] = references(validate_rule(rule))
            for source in dependencies[name]:
                if source not in by_name: fail(f'引用未知字段：{source}')
                if by_name[source].get('field_type') == 'json': fail('暂不支持明细或 JSON 字段')
            ui = field.get('ui_config') or {}
            if field.get('field_type') not in {'string', 'text', 'int', 'integer', 'float', 'number', 'decimal'}:
                fail('仅文本和数值字段可以配置计算规则')
            if ui.get('businessType') == 'code' or ui.get('relation_config'):
                fail('编码或关联字段不能同时作为计算结果')
            default = ui.get('defaultRule') or {}
            if default.get('enabled') is not False and (field.get('default_value') not in (None, '') or default):
                fail('计算字段不能同时配置默认值')
        except HTTPException as exc:
            errors.append(f'「{field.get("label") or name}」{exc.detail}')
    visited, visiting = set(), set()
    for name, field in by_name.items():
        ui = field.get('ui_config') or {}
        if ui.get('assignmentRulesEnabled') is False: continue
        assignments = ui.get('assignmentRules') or []
        relation = ui.get('relation_config') or {}
        backfill = (relation.get('backfill') or {}) if isinstance(relation, dict) else {}
        if name in dependencies and (assignments or backfill):
            errors.append(f'「{name}」计算字段不能同时作为赋值来源，请直接在目标公式中引用该字段')
        for target in [item.get('targetField') for item in assignments] + list(backfill):
            if target in dependencies:
                errors.append(f'「{target}」计算字段不能同时作为赋值目标')
    def visit(name):
        if name in visiting: fail('字段计算存在循环依赖')
        if name in visited: return
        visiting.add(name)
        for source in dependencies.get(name, set()): visit(source)
        visiting.remove(name); visited.add(name)
    try:
        for name in dependencies: visit(name)
    except HTTPException as exc:
        errors.append(str(exc.detail))
    return errors
