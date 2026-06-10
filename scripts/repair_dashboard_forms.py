"""Repair local analytics/dashboard form designs and sample records.

This script intentionally replaces the generic dashboard seed with
domain-specific dashboard definitions. It only targets known demo dashboard
forms and keeps the runtime contract simple: date, subject, category, actual,
target, and status fields are still used by the renderer, but every form gets
its own labels, metrics, widgets, filters, and records.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models.relational import DynamicRecord, Form, FormField, FormLayout


REPAIR_SOURCE = "application-assembly-dashboard-seed"


def dashboard(
    *,
    name: str,
    subject_label: str,
    category_label: str,
    actual_label: str,
    target_label: str,
    total_metric: str,
    actual_metric: str,
    rate_metric: str,
    total_widget: str,
    trend_widget: str,
    rank_widget: str,
    detail_widget: str,
    categories: list[str],
    records: list[tuple[str, str, str, float, float, str]],
) -> dict:
    return {
        "name": name,
        "fieldLabels": {
            "date": "日期",
            "subject": subject_label,
            "category": category_label,
            "actual": actual_label,
            "target": target_label,
            "status": "状态",
        },
        "metricNames": {
            "metric-total": total_metric,
            "metric-actual": actual_metric,
            "metric-rate": rate_metric,
        },
        "widgetTitles": {
            "widget-total": total_widget,
            "widget-trend": trend_widget,
            "widget-rank": rank_widget,
            "widget-detail": detail_widget,
        },
        "categories": categories,
        "records": [
            {
                "date": date,
                "subject": subject,
                "category": category,
                "actual": actual,
                "target": target,
                "status": status,
            }
            for date, subject, category, actual, target, status in records
        ],
    }


DASHBOARD_DEFINITIONS: dict[str, dict] = {
    "production-overview": dashboard(
        name="生产总览",
        subject_label="产线",
        category_label="班次",
        actual_label="实际产量",
        target_label="计划产量",
        total_metric="监控产线",
        actual_metric="实际产量",
        rate_metric="计划达成率",
        total_widget="生产核心指标",
        trend_widget="近日产量达成趋势",
        rank_widget="产线达成排行",
        detail_widget="产线生产明细",
        categories=["早班", "中班", "夜班"],
        records=[
            ("2026-06-05", "上海ASSEMBLY-530-C线", "早班", 1280, 1350, "正常"),
            ("2026-06-06", "宁波WAREHOUSE-012-A线", "中班", 940, 1000, "观察"),
            ("2026-06-07", "武汉PACKAGING-063-D线", "夜班", 760, 920, "预警"),
            ("2026-06-08", "苏州PACKAGING-045-B线", "早班", 1420, 1380, "正常"),
        ],
    ),
    "oee-trend-report": dashboard(
        name="OEE 趋势报表",
        subject_label="产线",
        category_label="OEE 因子",
        actual_label="OEE",
        target_label="目标 OEE",
        total_metric="采样天数",
        actual_metric="OEE 合计",
        rate_metric="目标达成率",
        total_widget="OEE 周期概览",
        trend_widget="OEE 日趋势",
        rank_widget="产线 OEE 排行",
        detail_widget="OEE 因子明细",
        categories=["可用率", "性能", "质量"],
        records=[
            ("2026-06-05", "SMT-03", "可用率", 86.2, 90, "观察"),
            ("2026-06-06", "Assembly-A", "性能", 91.5, 90, "正常"),
            ("2026-06-07", "Packaging-B", "质量", 83.4, 90, "预警"),
            ("2026-06-08", "Testing-C", "可用率", 88.9, 90, "观察"),
        ],
    ),
    "line-status": dashboard(
        name="产线状态",
        subject_label="产线",
        category_label="运行模式",
        actual_label="实时负荷",
        target_label="目标负荷",
        total_metric="在线产线",
        actual_metric="负荷合计",
        rate_metric="负荷达标率",
        total_widget="产线运行概览",
        trend_widget="负荷变化趋势",
        rank_widget="产线负荷排行",
        detail_widget="产线状态明细",
        categories=["运行", "待料", "换型", "停线"],
        records=[
            ("2026-06-05", "SMT-03", "运行", 82, 85, "正常"),
            ("2026-06-06", "Assembly-A", "换型", 66, 80, "观察"),
            ("2026-06-07", "Packaging-B", "待料", 48, 75, "预警"),
            ("2026-06-08", "Testing-C", "运行", 91, 85, "正常"),
        ],
    ),
    "line-load-analysis": dashboard(
        name="产线负荷分析",
        subject_label="产线",
        category_label="瓶颈工位",
        actual_label="负荷率",
        target_label="均衡目标",
        total_metric="分析产线",
        actual_metric="负荷合计",
        rate_metric="均衡达成率",
        total_widget="负荷均衡指标",
        trend_widget="负荷热度趋势",
        rank_widget="瓶颈产线排行",
        detail_widget="负荷拆解明细",
        categories=["贴片", "组装", "包装", "测试"],
        records=[
            ("2026-06-05", "SMT-03", "贴片", 96, 85, "预警"),
            ("2026-06-06", "Assembly-A", "组装", 78, 85, "观察"),
            ("2026-06-07", "Packaging-B", "包装", 69, 85, "观察"),
            ("2026-06-08", "Testing-C", "测试", 88, 85, "正常"),
        ],
    ),
    "device-health": dashboard(
        name="设备健康",
        subject_label="设备",
        category_label="设备类型",
        actual_label="健康度",
        target_label="健康目标",
        total_metric="监控设备",
        actual_metric="健康度合计",
        rate_metric="健康达标率",
        total_widget="设备健康指标",
        trend_widget="健康度趋势",
        rank_widget="低健康设备排行",
        detail_widget="设备风险明细",
        categories=["回流焊", "贴片机", "空压机", "测试台"],
        records=[
            ("2026-06-05", "SMT-03 回流焊", "回流焊", 79, 90, "预警"),
            ("2026-06-06", "NXT-12 贴片机", "贴片机", 92, 90, "正常"),
            ("2026-06-07", "AIR-COMP-02", "空压机", 84, 90, "观察"),
            ("2026-06-08", "ICT-08 测试台", "测试台", 88, 90, "观察"),
        ],
    ),
    "device-health-dashboard": dashboard(
        name="设备健康看板",
        subject_label="设备",
        category_label="风险因子",
        actual_label="健康评分",
        target_label="目标评分",
        total_metric="关键设备",
        actual_metric="健康评分合计",
        rate_metric="健康目标达成",
        total_widget="预测维护核心指标",
        trend_widget="健康评分趋势",
        rank_widget="高风险设备排行",
        detail_widget="维护建议明细",
        categories=["温度", "振动", "电流", "点检"],
        records=[
            ("2026-06-05", "SMT-03 回流焊", "温度", 76, 90, "预警"),
            ("2026-06-06", "Assembly-A 主线", "振动", 88, 90, "观察"),
            ("2026-06-07", "AIR-COMP-02", "电流", 82, 90, "观察"),
            ("2026-06-08", "PACK-05 封装机", "点检", 93, 90, "正常"),
        ],
    ),
    "fault-prediction": dashboard(
        name="故障预测",
        subject_label="设备",
        category_label="预测故障",
        actual_label="故障概率",
        target_label="阈值",
        total_metric="预测对象",
        actual_metric="风险概率合计",
        rate_metric="阈值占比",
        total_widget="预测风险指标",
        trend_widget="故障概率趋势",
        rank_widget="故障概率排行",
        detail_widget="预测依据明细",
        categories=["轴承磨损", "温区漂移", "气压不足", "传感器异常"],
        records=[
            ("2026-06-05", "AIR-COMP-02", "气压不足", 72, 60, "预警"),
            ("2026-06-06", "SMT-03 回流焊", "温区漂移", 64, 60, "预警"),
            ("2026-06-07", "NXT-12 贴片机", "轴承磨损", 38, 60, "正常"),
            ("2026-06-08", "ICT-08 测试台", "传感器异常", 52, 60, "观察"),
        ],
    ),
    "failure-trend-analysis": dashboard(
        name="故障趋势分析",
        subject_label="故障类别",
        category_label="设备族",
        actual_label="故障次数",
        target_label="控制目标",
        total_metric="故障类别",
        actual_metric="故障次数",
        rate_metric="控制达成率",
        total_widget="故障趋势指标",
        trend_widget="故障次数趋势",
        rank_widget="故障类别排行",
        detail_widget="故障原因明细",
        categories=["贴片设备", "热工设备", "公辅设备", "测试设备"],
        records=[
            ("2026-06-05", "温区漂移", "热工设备", 8, 5, "预警"),
            ("2026-06-06", "吸嘴堵塞", "贴片设备", 4, 5, "正常"),
            ("2026-06-07", "气压波动", "公辅设备", 6, 5, "观察"),
            ("2026-06-08", "探针接触不良", "测试设备", 3, 5, "正常"),
        ],
    ),
    "quality-overview": dashboard(
        name="质量总览",
        subject_label="产品族",
        category_label="质量阶段",
        actual_label="合格率",
        target_label="目标合格率",
        total_metric="质量对象",
        actual_metric="合格率合计",
        rate_metric="目标达成率",
        total_widget="质量核心指标",
        trend_widget="合格率趋势",
        rank_widget="产品族质量排行",
        detail_widget="质量表现明细",
        categories=["来料", "过程", "出货", "客诉"],
        records=[
            ("2026-06-05", "传感器模块", "过程", 96.2, 98, "观察"),
            ("2026-06-06", "密封组件", "出货", 98.6, 98, "正常"),
            ("2026-06-07", "精密壳体", "来料", 94.8, 98, "预警"),
            ("2026-06-08", "控制板", "客诉", 97.5, 98, "观察"),
        ],
    ),
    "defect-analysis": dashboard(
        name="缺陷分析",
        subject_label="缺陷类型",
        category_label="责任工位",
        actual_label="缺陷件数",
        target_label="控制上限",
        total_metric="缺陷类型",
        actual_metric="缺陷件数",
        rate_metric="控制达成率",
        total_widget="缺陷核心指标",
        trend_widget="缺陷发生趋势",
        rank_widget="缺陷 Pareto 排行",
        detail_widget="缺陷归因明细",
        categories=["焊接", "装配", "外观", "测试"],
        records=[
            ("2026-06-05", "焊点虚焊", "焊接", 18, 10, "预警"),
            ("2026-06-06", "壳体划伤", "外观", 7, 10, "正常"),
            ("2026-06-07", "密封不良", "装配", 11, 10, "观察"),
            ("2026-06-08", "功能误判", "测试", 5, 10, "正常"),
        ],
    ),
    "defect-analysis-report": dashboard(
        name="缺陷分析报表",
        subject_label="缺陷主题",
        category_label="根因分类",
        actual_label="发生次数",
        target_label="月度目标",
        total_metric="分析主题",
        actual_metric="发生次数",
        rate_metric="改善达成率",
        total_widget="缺陷报表摘要",
        trend_widget="缺陷改善趋势",
        rank_widget="根因分类排行",
        detail_widget="改善动作明细",
        categories=["人", "机", "料", "法"],
        records=[
            ("2026-06-05", "焊接空洞", "法", 12, 8, "预警"),
            ("2026-06-06", "来料尺寸波动", "料", 9, 8, "观察"),
            ("2026-06-07", "设备定位偏移", "机", 6, 8, "正常"),
            ("2026-06-08", "作业漏检", "人", 4, 8, "正常"),
        ],
    ),
    "process-capability-dashboard": dashboard(
        name="过程能力看板",
        subject_label="工序",
        category_label="质量特性",
        actual_label="CPK",
        target_label="目标 CPK",
        total_metric="监控特性",
        actual_metric="CPK 合计",
        rate_metric="能力达成率",
        total_widget="过程能力指标",
        trend_widget="CPK 趋势",
        rank_widget="低能力工序排行",
        detail_widget="SPC 能力明细",
        categories=["尺寸", "扭矩", "温度", "电性能"],
        records=[
            ("2026-06-05", "回流焊温区5", "温度", 1.18, 1.33, "预警"),
            ("2026-06-06", "壳体压装", "尺寸", 1.42, 1.33, "正常"),
            ("2026-06-07", "端子锁附", "扭矩", 1.29, 1.33, "观察"),
            ("2026-06-08", "ICT 测试", "电性能", 1.51, 1.33, "正常"),
        ],
    ),
    "supplier-risk": dashboard(
        name="供应商风险",
        subject_label="供应商",
        category_label="风险维度",
        actual_label="风险评分",
        target_label="风险阈值",
        total_metric="评估供应商",
        actual_metric="风险评分合计",
        rate_metric="阈值占比",
        total_widget="供应风险指标",
        trend_widget="风险评分趋势",
        rank_widget="高风险供应商排行",
        detail_widget="供应商风险明细",
        categories=["交付", "质量", "产能", "区域"],
        records=[
            ("2026-06-05", "北辰材料", "交付", 78, 70, "预警"),
            ("2026-06-06", "华东精密", "质量", 42, 70, "正常"),
            ("2026-06-07", "明达物流", "区域", 68, 70, "观察"),
            ("2026-06-08", "中芯辅材", "产能", 73, 70, "预警"),
        ],
    ),
    "inventory-impact": dashboard(
        name="库存影响",
        subject_label="物料",
        category_label="风险来源",
        actual_label="缺口数量",
        target_label="安全库存",
        total_metric="影响物料",
        actual_metric="缺口数量",
        rate_metric="库存覆盖率",
        total_widget="库存影响指标",
        trend_widget="库存缺口趋势",
        rank_widget="缺口物料排行",
        detail_widget="库存影响明细",
        categories=["短缺", "在途", "冻结", "替代料"],
        records=[
            ("2026-06-05", "锡膏 SAC305", "短缺", 420, 800, "预警"),
            ("2026-06-06", "BGA-载板-022", "替代料", 180, 500, "观察"),
            ("2026-06-07", "密封圈 R18", "冻结", 95, 400, "正常"),
            ("2026-06-08", "传感器芯片 X7", "在途", 260, 600, "观察"),
        ],
    ),
    "supplier-scorecard": dashboard(
        name="供应商评分",
        subject_label="供应商",
        category_label="评分维度",
        actual_label="实际得分",
        target_label="目标得分",
        total_metric="评分供应商",
        actual_metric="综合得分",
        rate_metric="目标达成率",
        total_widget="供应商评分指标",
        trend_widget="评分趋势",
        rank_widget="供应商评分排行",
        detail_widget="供应商评分明细",
        categories=["交付", "质量", "成本", "服务"],
        records=[
            ("2026-06-05", "北辰材料", "交付", 82.5, 90, "观察"),
            ("2026-06-06", "华东精密", "质量", 91.2, 90, "正常"),
            ("2026-06-07", "明达物流", "服务", 76.8, 85, "预警"),
            ("2026-06-08", "中芯辅材", "成本", 88.4, 90, "正常"),
        ],
    ),
    "material-impact": dashboard(
        name="物料影响",
        subject_label="物料",
        category_label="影响环节",
        actual_label="缺口数量",
        target_label="安全库存",
        total_metric="影响物料",
        actual_metric="缺口数量",
        rate_metric="库存覆盖率",
        total_widget="物料影响指标",
        trend_widget="缺口变化趋势",
        rank_widget="物料缺口排行",
        detail_widget="影响产线明细",
        categories=["采购", "仓储", "生产", "替代料"],
        records=[
            ("2026-06-05", "锡膏 SAC305", "采购", 420, 800, "预警"),
            ("2026-06-06", "BGA-载板-022", "替代料", 180, 500, "观察"),
            ("2026-06-07", "密封圈-R18", "仓储", 95, 400, "正常"),
            ("2026-06-08", "传感器芯片-X7", "生产", 260, 600, "观察"),
        ],
    ),
    "material-impact-report": dashboard(
        name="物料影响报表",
        subject_label="物料族",
        category_label="影响类型",
        actual_label="影响工单",
        target_label="控制目标",
        total_metric="物料族",
        actual_metric="影响工单",
        rate_metric="控制达成率",
        total_widget="物料报表摘要",
        trend_widget="影响工单趋势",
        rank_widget="物料族影响排行",
        detail_widget="物料缓解明细",
        categories=["短缺", "替代", "冻结", "延迟"],
        records=[
            ("2026-06-05", "电子料", "短缺", 14, 8, "预警"),
            ("2026-06-06", "结构件", "延迟", 7, 8, "正常"),
            ("2026-06-07", "包装料", "替代", 5, 8, "正常"),
            ("2026-06-08", "化学品", "冻结", 9, 8, "观察"),
        ],
    ),
    "supply-overview": dashboard(
        name="供应总览",
        subject_label="供应链对象",
        category_label="运营环节",
        actual_label="完成量",
        target_label="计划量",
        total_metric="运营对象",
        actual_metric="完成量",
        rate_metric="计划达成率",
        total_widget="供应运营指标",
        trend_widget="供应完成趋势",
        rank_widget="对象达成排行",
        detail_widget="供应运营明细",
        categories=["采购", "仓储", "物流", "供应商"],
        records=[
            ("2026-06-05", "采购订单", "采购", 186, 200, "观察"),
            ("2026-06-06", "入库批次", "仓储", 214, 210, "正常"),
            ("2026-06-07", "运输任务", "物流", 92, 100, "观察"),
            ("2026-06-08", "供应商响应", "供应商", 76, 80, "正常"),
        ],
    ),
    "supply-risk-dashboard": dashboard(
        name="供应风险看板",
        subject_label="风险对象",
        category_label="风险来源",
        actual_label="风险指数",
        target_label="控制阈值",
        total_metric="风险对象",
        actual_metric="风险指数合计",
        rate_metric="阈值占比",
        total_widget="供应风险核心指标",
        trend_widget="风险指数趋势",
        rank_widget="供应风险排行",
        detail_widget="风险处置明细",
        categories=["交付", "质量", "库存", "区域"],
        records=[
            ("2026-06-05", "北辰材料交付", "交付", 82, 70, "预警"),
            ("2026-06-06", "BGA 载板库存", "库存", 66, 70, "观察"),
            ("2026-06-07", "华东精密质量", "质量", 58, 70, "正常"),
            ("2026-06-08", "港口延误", "区域", 74, 70, "预警"),
        ],
    ),
}


FIELD_KEYS = ["date", "subject", "category", "actual", "target", "status"]


DASHBOARD_WIDGET_PROFILES: dict[str, list[dict]] = {
    "production-overview": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual", "metric-rate"], "width": "full", "interaction": "none"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "bar", "metricIds": ["metric-actual"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-rank", "titleKey": "widget-rank", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "oee-trend-report": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-rate"], "width": "full", "interaction": "none"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "line", "metricIds": ["metric-rate"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-structure", "title": "OEE 因子结构", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "line-status": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual"], "width": "full", "interaction": "none"},
        {"id": "widget-structure", "title": "运行状态占比", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "line-load-analysis": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual", "metric-rate"], "width": "full", "interaction": "none"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "filter"},
        {"id": "widget-balance", "title": "负荷均衡趋势", "type": "line", "metricIds": ["metric-rate"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-rank", "titleKey": "widget-rank", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "category", "width": "half", "interaction": "navigate"},
    ],
    "device-health": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-rate"], "width": "full", "interaction": "none"},
        {"id": "widget-risk", "title": "设备健康分布", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-structure", "title": "设备类型结构", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "device-health-dashboard": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual", "metric-rate"], "width": "full", "interaction": "none"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "line", "metricIds": ["metric-actual"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-rank", "titleKey": "widget-rank", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "fault-prediction": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual"], "width": "full", "interaction": "none"},
        {"id": "widget-risk", "titleKey": "widget-trend", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "filter"},
        {"id": "widget-rank", "titleKey": "widget-rank", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
    ],
    "failure-trend-analysis": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual"], "width": "full", "interaction": "none"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "line", "metricIds": ["metric-actual"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-category", "titleKey": "widget-rank", "type": "bar", "metricIds": ["metric-actual"], "dimension": "category", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "category", "width": "full", "interaction": "navigate"},
    ],
    "quality-overview": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-rate"], "width": "full", "interaction": "none"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "line", "metricIds": ["metric-rate"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-structure", "title": "质量结构占比", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-rank", "titleKey": "widget-rank", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "half", "interaction": "navigate"},
    ],
    "defect-analysis": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual"], "width": "full", "interaction": "none"},
        {"id": "widget-pareto", "titleKey": "widget-rank", "type": "bar", "metricIds": ["metric-actual"], "dimension": "category", "width": "half", "interaction": "drilldown"},
        {"id": "widget-structure", "title": "缺陷结构占比", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-rank", "title": "缺陷对象排行", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "category", "width": "full", "interaction": "navigate"},
    ],
    "defect-analysis-report": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual", "metric-rate"], "width": "full", "interaction": "none"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "line", "metricIds": ["metric-rate"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-action", "titleKey": "widget-rank", "type": "bar", "metricIds": ["metric-actual"], "dimension": "category", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "process-capability-dashboard": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-rate"], "width": "full", "interaction": "none"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "line", "metricIds": ["metric-actual"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-capability", "titleKey": "widget-rank", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "supplier-risk": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual"], "width": "full", "interaction": "none"},
        {"id": "widget-risk", "titleKey": "widget-trend", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "filter"},
        {"id": "widget-rank", "title": "高风险对象排行", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "material-impact": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual", "metric-rate"], "width": "full", "interaction": "none"},
        {"id": "widget-shortage", "titleKey": "widget-rank", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-structure", "title": "影响环节占比", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "material-impact-report": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual"], "width": "full", "interaction": "none"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "line", "metricIds": ["metric-actual"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-rank", "titleKey": "widget-rank", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "category", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "supply-overview": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-rate"], "width": "full", "interaction": "none"},
        {"id": "widget-progress", "titleKey": "widget-rank", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-trend", "titleKey": "widget-trend", "type": "line", "metricIds": ["metric-rate"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "supply-risk-dashboard": [
        {"id": "widget-total", "titleKey": "widget-total", "type": "metric-card", "metricIds": ["metric-total", "metric-actual"], "width": "full", "interaction": "none"},
        {"id": "widget-structure", "title": "风险结构占比", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-risk", "title": "风险评分分布", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-rank", "titleKey": "widget-rank", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-detail", "titleKey": "widget-detail", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "half", "interaction": "navigate"},
    ],
}


DASHBOARD_EXTRA_WIDGETS: dict[str, list[dict]] = {
    "production-overview": [
        {"id": "widget-shift-mix", "title": "班次产量结构", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-target-gap", "title": "计划差异对比", "type": "bar", "metricIds": ["metric-rate"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
    ],
    "oee-trend-report": [
        {"id": "widget-factor-bar", "title": "OEE 因子对比", "type": "bar", "metricIds": ["metric-actual"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-target-rank", "title": "目标偏差排行", "type": "rank-table", "metricIds": ["metric-rate"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
    ],
    "line-status": [
        {"id": "widget-load-rank", "title": "负荷异常排行", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-mode-trend", "title": "运行模式趋势", "type": "line", "metricIds": ["metric-rate"], "dimension": "date", "width": "half", "interaction": "filter"},
    ],
    "line-load-analysis": [
        {"id": "widget-category-structure", "title": "工位负荷结构", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-gap-detail", "title": "均衡差异明细", "type": "detail-table", "metricIds": ["metric-rate"], "dimension": "subject", "width": "half", "interaction": "navigate"},
    ],
    "device-health": [
        {"id": "widget-health-trend", "title": "健康评分走势", "type": "line", "metricIds": ["metric-actual"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-maintenance-rank", "title": "维护优先级排行", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
    ],
    "device-health-dashboard": [
        {"id": "widget-risk-factor", "title": "风险因子结构", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-maintenance-gap", "title": "维护目标差异", "type": "bar", "metricIds": ["metric-rate"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
    ],
    "fault-prediction": [
        {"id": "widget-probability-trend", "title": "概率变化趋势", "type": "line", "metricIds": ["metric-rate"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-fault-structure", "title": "故障类型结构", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-evidence-detail", "title": "预测证据明细", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "full", "interaction": "navigate"},
    ],
    "failure-trend-analysis": [
        {"id": "widget-frequency-rank", "title": "高频故障排行", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-cause-structure", "title": "原因结构占比", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
    ],
    "quality-overview": [
        {"id": "widget-pass-bar", "title": "产品族合格对比", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
        {"id": "widget-quality-warning", "title": "质量预警明细", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "category", "width": "half", "interaction": "navigate"},
    ],
    "defect-analysis": [
        {"id": "widget-defect-trend", "title": "缺陷波动趋势", "type": "line", "metricIds": ["metric-rate"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-defect-detail", "title": "缺陷样本明细", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "half", "interaction": "navigate"},
    ],
    "defect-analysis-report": [
        {"id": "widget-root-structure", "title": "根因结构占比", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-action-rank", "title": "改善优先级排行", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
    ],
    "process-capability-dashboard": [
        {"id": "widget-cpk-structure", "title": "能力等级结构", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-spc-rank", "title": "SPC 异常排行", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
    ],
    "supplier-risk": [
        {"id": "widget-risk-structure", "title": "风险维度结构", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-mitigation-trend", "title": "风险缓解趋势", "type": "line", "metricIds": ["metric-rate"], "dimension": "date", "width": "half", "interaction": "filter"},
    ],
    "material-impact": [
        {"id": "widget-shortage-trend", "title": "缺口滚动趋势", "type": "line", "metricIds": ["metric-actual"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-recovery-rank", "title": "恢复优先级排行", "type": "rank-table", "metricIds": ["metric-rate"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
    ],
    "material-impact-report": [
        {"id": "widget-family-structure", "title": "物料族影响结构", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-workorder-bar", "title": "工单影响对比", "type": "bar", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
    ],
    "supply-overview": [
        {"id": "widget-supply-structure", "title": "供应状态结构", "type": "pie", "metricIds": ["metric-rate"], "dimension": "category", "width": "half", "interaction": "filter"},
        {"id": "widget-supply-rank", "title": "交付风险排行", "type": "rank-table", "metricIds": ["metric-actual"], "dimension": "subject", "width": "half", "interaction": "drilldown"},
    ],
    "supply-risk-dashboard": [
        {"id": "widget-response-trend", "title": "处置响应趋势", "type": "line", "metricIds": ["metric-rate"], "dimension": "date", "width": "half", "interaction": "filter"},
        {"id": "widget-risk-detail-plus", "title": "风险闭环明细", "type": "detail-table", "metricIds": ["metric-total"], "dimension": "subject", "width": "half", "interaction": "navigate"},
    ],
}


def field_defs(definition: dict) -> list[tuple[str, str, str, bool, bool, bool, bool, bool]]:
    labels = definition["fieldLabels"]
    return [
        ("date", labels["date"], "date", True, True, True, True, True),
        ("subject", labels["subject"], "string", True, True, True, True, False),
        ("category", labels["category"], "string", False, True, True, True, False),
        ("actual", labels["actual"], "decimal", False, True, True, False, True),
        ("target", labels["target"], "decimal", False, True, True, False, True),
        ("status", labels["status"], "enum", False, True, True, True, False),
    ]


def make_design(code: str, definition: dict) -> dict:
    dataset_id = f"{code}-dataset"
    metric_names = definition["metricNames"]
    widget_titles = definition["widgetTitles"]
    widget_profile = [
        *DASHBOARD_WIDGET_PROFILES.get(code, DASHBOARD_WIDGET_PROFILES["production-overview"]),
        *DASHBOARD_EXTRA_WIDGETS.get(code, []),
    ]
    widgets = [
        {
            "id": item["id"],
            "title": item.get("title") or widget_titles.get(item.get("titleKey"), item["id"]),
            "type": item["type"],
            "datasetId": dataset_id,
            "metricIds": item.get("metricIds", ["metric-actual"]),
            "dimension": item.get("dimension", "subject"),
            "width": item.get("width", "half"),
            "interaction": item.get("interaction", "filter"),
        }
        for item in widget_profile
    ]
    detail_widget_id = next((item["id"] for item in widgets if item["type"] == "detail-table"), "")
    interactions = []
    if detail_widget_id:
        for item in widgets:
            if item["id"] == detail_widget_id or item["type"] == "metric-card":
                continue
            interactions.append(
                {
                    "sourceWidgetId": item["id"],
                    "targetWidgetId": detail_widget_id,
                    "action": "drilldown" if item["type"] == "rank-table" else "filter",
                }
            )
    return {
        "datasets": [
            {
                "id": dataset_id,
                "name": f"{definition['name']}数据集",
                "sourceType": "businessForm",
                "source": code,
                "refreshMode": "realtime",
                "dimensions": ["date", "subject", "category", "status"],
                "measures": ["actual", "target"],
            }
        ],
        "metrics": [
            {"id": "metric-total", "name": metric_names["metric-total"], "expression": "count(*)", "datasetId": dataset_id, "format": "number", "threshold": "正常 >= 0"},
            {"id": "metric-actual", "name": metric_names["metric-actual"], "expression": "sum(actual)", "datasetId": dataset_id, "format": "number", "threshold": "正常 >= 0"},
            {"id": "metric-rate", "name": metric_names["metric-rate"], "expression": "actual / target", "datasetId": dataset_id, "format": "percent", "threshold": "绿色 >= 90%"},
        ],
        "widgets": widgets,
        "globalFilters": ["date", "category", "status"],
        "interactions": interactions,
        "style": {"theme": "light", "primaryColor": "#2563eb", "accentColor": "#16a34a", "density": "middle"},
    }


def make_view_config(definition: dict) -> dict:
    columns = []
    filters = []
    for index, (field_name, label, _field_type, _required, visible_list, _visible_form, searchable, sortable) in enumerate(field_defs(definition)):
        if visible_list:
            columns.append(
                {
                    "id": f"col-{field_name}",
                    "fieldName": field_name,
                    "label": label,
                    "enabled": True,
                    "order": index,
                    "width": 150 if field_name != "subject" else 220,
                    "sortable": sortable,
                    "renderType": "tag" if field_name == "status" else "text",
                    "emptyText": "-",
                }
            )
        if searchable:
            filters.append(
                {
                    "id": f"filter-{field_name}",
                    "fieldName": field_name,
                    "label": label,
                    "controlType": "keyword",
                    "operator": "contains",
                    "enabled": True,
                    "order": index,
                }
            )
    return {
        "filters": filters,
        "table": {
            "columns": columns,
            "pageSize": 10,
            "density": "middle",
            "rowClickAction": "detail",
            "toolbarActions": ["refresh", "export", "settings"],
            "rowActions": ["detail"],
        },
    }


async def ensure_layout(db, form: Form, layout_type: str, config: dict) -> bool:
    layout = await db.scalar(select(FormLayout).where(FormLayout.form_id == form.id, FormLayout.layout_type == layout_type))
    if layout is None:
        db.add(FormLayout(tenant_id=form.tenant_id, form_id=form.id, layout_type=layout_type, config=config))
        return True
    layout.config = config
    return True


async def upsert_fields(db, form: Form, definition: dict) -> bool:
    changed = False
    existing = {
        field.field_name: field
        for field in (await db.execute(select(FormField).where(FormField.form_id == form.id))).scalars().all()
    }
    for order, (field_name, label, field_type, required, visible_list, visible_form, searchable, sortable) in enumerate(field_defs(definition)):
        field = existing.get(field_name)
        if field is None:
            db.add(
                FormField(
                    tenant_id=form.tenant_id,
                    form_id=form.id,
                    field_name=field_name,
                    label=label,
                    field_type=field_type,
                    required=required,
                    visible_in_list=visible_list,
                    visible_in_form=visible_form,
                    searchable=searchable,
                    sortable=sortable,
                    archived=False,
                    enum_values={"values": ["正常", "观察", "预警", "关闭"]} if field_type == "enum" else None,
                    sort_order=order,
                )
            )
            changed = True
            continue
        updates = {
            "label": label,
            "field_type": field_type,
            "required": required,
            "visible_in_list": visible_list,
            "visible_in_form": visible_form,
            "searchable": searchable,
            "sortable": sortable,
            "archived": False,
            "sort_order": order,
        }
        for key, value in updates.items():
            if getattr(field, key) != value:
                setattr(field, key, value)
                changed = True
        if field_type == "enum" and field.enum_values != {"values": ["正常", "观察", "预警", "关闭"]}:
            field.enum_values = {"values": ["正常", "观察", "预警", "关闭"]}
            changed = True
    return changed


async def replace_seed_records(db, form: Form, definition: dict) -> tuple[bool, int]:
    records = (
        await db.execute(
            select(DynamicRecord)
            .where(DynamicRecord.form_id == form.id, DynamicRecord.deleted_at.is_(None))
            .order_by(DynamicRecord.created_at.asc(), DynamicRecord.id.asc())
        )
    ).scalars().all()
    before = len(records)
    base_time = datetime.now()
    seed_records = definition["records"]
    changed = False
    for index, data in enumerate(seed_records):
        created_at = base_time - timedelta(days=len(seed_records) - index)
        if index < len(records):
            record = records[index]
            if record.data != data or record.status != str(data.get("status") or "正常"):
                record.data = data
                record.status = str(data.get("status") or "正常")
                record.updated_at = created_at
                changed = True
        else:
            db.add(
                DynamicRecord(
                    tenant_id=form.tenant_id,
                    form_id=form.id,
                    model_id=form.model_id,
                    data=data,
                    schema_version=1,
                    status=str(data.get("status") or "正常"),
                    created_at=created_at,
                    updated_at=created_at,
                )
            )
            changed = True
    return changed, before


async def repair_form(db, form: Form, definition: dict) -> dict:
    now = datetime.now().isoformat()
    design = make_design(form.code, definition)
    view_config = make_view_config(definition)
    config = dict(form.config or {})
    changed = False

    next_meta = {
        "draftVersion": int((config.get("analyticsDesignMeta") or {}).get("draftVersion") or 1),
        "publishedVersion": int((config.get("analyticsDesignMeta") or {}).get("publishedVersion") or 1),
        "draftSavedAt": now,
        "publishedAt": now,
        "status": "published",
    }
    config.update(
        {
            "source": REPAIR_SOURCE,
            "assemblyKind": "analysis",
            "analyticsDesign": design,
            "analyticsDesignDraft": design,
            "analyticsDesignMeta": next_meta,
            "viewConfig": view_config,
            "viewConfigDraft": view_config,
            "viewConfigMeta": {
                "draftVersion": 1,
                "publishedVersion": 1,
                "draftSavedAt": now,
                "publishedAt": now,
                "status": "published",
            },
        }
    )
    form.config = config
    changed = True

    changed = await upsert_fields(db, form, definition) or changed
    changed = await ensure_layout(db, form, "list", {"viewConfig": view_config}) or changed
    changed = await ensure_layout(db, form, "analytics", {"draft": design, "published": design, "meta": next_meta}) or changed
    records_changed, record_count = await replace_seed_records(db, form, definition)
    changed = records_changed or changed

    return {"code": form.code, "changed": changed, "records_before": record_count}


async def main() -> None:
    async with AsyncSessionLocal() as db:
        results = []
        for code, definition in DASHBOARD_DEFINITIONS.items():
            form = await db.scalar(select(Form).where(Form.code == code))
            if form is None:
                results.append({"code": code, "missing": True})
                continue
            results.append(await repair_form(db, form, definition))
        await db.commit()
        for result in results:
            if result.get("missing"):
                print(f"{result['code']}: missing")
            else:
                print(f"{result['code']}: {'updated' if result['changed'] else 'unchanged'}, records_before={result['records_before']}")


if __name__ == "__main__":
    asyncio.run(main())
