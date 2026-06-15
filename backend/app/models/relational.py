import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    Index,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class SystemSetting(TimestampMixin, Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)


# ── 工厂族 ──────────────────────────────────────────────

class AIAgentSkillDefinition(TimestampMixin, Base):
    __tablename__ = "ai_agent_skill_definitions"
    __table_args__ = (
        UniqueConstraint("name", name="uq_ai_agent_skill_definitions_name"),
        Index("ix_ai_agent_skill_definitions_enabled", "enabled"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    title: Mapped[str] = mapped_column(String(240), default="")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    definition: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    source: Mapped[str] = mapped_column(String(80), default="seed")
    updated_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)


class AIAgentToolDefinition(TimestampMixin, Base):
    __tablename__ = "ai_agent_tool_definitions"
    __table_args__ = (
        UniqueConstraint("name", name="uq_ai_agent_tool_definitions_name"),
        Index("ix_ai_agent_tool_definitions_enabled", "enabled"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    title: Mapped[str] = mapped_column(String(240), default="")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    handler_key: Mapped[str] = mapped_column(String(160), default="not_implemented")
    definition: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    source: Mapped[str] = mapped_column(String(80), default="seed")
    updated_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)


class Factory(TimestampMixin, Base):
    __tablename__ = "factories"
    __table_args__ = (Index("ix_factories_tenant_status", "tenant_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    location: Mapped[str] = mapped_column(String(500))
    capacity: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(50), default="active")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    workshops: Mapped[list["Workshop"]] = relationship(back_populates="factory")


class Workshop(TimestampMixin, Base):
    __tablename__ = "workshops"
    __table_args__ = (Index("ix_workshops_tenant_factory", "tenant_id", "factory_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    factory_id: Mapped[int] = mapped_column(ForeignKey("factories.id"))
    area: Mapped[float] = mapped_column(Float, default=0)
    workshop_type: Mapped[str] = mapped_column(String(100), default="production")

    factory: Mapped["Factory"] = relationship(back_populates="workshops")
    production_lines: Mapped[list["ProductionLine"]] = relationship(back_populates="workshop")


class ProductionLine(TimestampMixin, Base):
    __tablename__ = "production_lines"
    __table_args__ = (Index("ix_production_lines_tenant_status", "tenant_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    workshop_id: Mapped[int] = mapped_column(ForeignKey("workshops.id"))
    capacity: Mapped[float] = mapped_column(Float, default=0)
    oee_target: Mapped[float] = mapped_column(Float, default=0.85)
    status: Mapped[str] = mapped_column(String(50), default="running")

    workshop: Mapped["Workshop"] = relationship(back_populates="production_lines")
    equipment_list: Mapped[list["Equipment"]] = relationship(back_populates="production_line")


class EquipmentStatus(str, enum.Enum):
    RUNNING = "running"
    IDLE = "idle"
    MAINTENANCE = "maintenance"
    FAULT = "fault"
    OFFLINE = "offline"


class Equipment(TimestampMixin, Base):
    __tablename__ = "equipment"
    __table_args__ = (Index("ix_equipment_tenant_status", "tenant_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    line_id: Mapped[int] = mapped_column(ForeignKey("production_lines.id"))
    model: Mapped[str] = mapped_column(String(200))
    manufacturer: Mapped[str] = mapped_column(String(200))
    install_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="running")
    health_score: Mapped[float] = mapped_column(Float, default=100.0)

    production_line: Mapped["ProductionLine"] = relationship(back_populates="equipment_list")
    sensors: Mapped[list["Sensor"]] = relationship(back_populates="equipment")


class Sensor(TimestampMixin, Base):
    __tablename__ = "sensors"
    __table_args__ = (Index("ix_sensors_tenant_equipment", "tenant_id", "equipment_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipment.id"))
    sensor_type: Mapped[str] = mapped_column(String(100))
    unit: Mapped[str] = mapped_column(String(50))
    sampling_rate: Mapped[int] = mapped_column(Integer, default=60)

    equipment: Mapped["Equipment"] = relationship(back_populates="sensors")
    readings: Mapped[list["SensorReading"]] = relationship(back_populates="sensor")


class SensorReading(Base):
    __tablename__ = "sensor_readings"
    __table_args__ = (Index("ix_sensor_readings_tenant_sensor_time", "tenant_id", "sensor_id", "timestamp"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    sensor_id: Mapped[int] = mapped_column(ForeignKey("sensors.id"))
    value: Mapped[float] = mapped_column(Float)
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)

    sensor: Mapped["Sensor"] = relationship(back_populates="readings")


# ── 产品族 ──────────────────────────────────────────────

class Product(TimestampMixin, Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("tenant_id", "sku", name="uq_products_tenant_sku"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    sku: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(100))
    specs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(50), default="个")


class Material(TimestampMixin, Base):
    __tablename__ = "materials"
    __table_args__ = (Index("ix_materials_tenant_type", "tenant_id", "material_type"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    material_type: Mapped[str] = mapped_column(String(100))
    specs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(50), default="个")
    safety_stock: Mapped[float] = mapped_column(Float, default=0)


class BOM(TimestampMixin, Base):
    __tablename__ = "bom"
    __table_args__ = (Index("ix_bom_tenant_product", "tenant_id", "product_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"))
    quantity: Mapped[float] = mapped_column(Float)
    level: Mapped[int] = mapped_column(Integer, default=1)


class ProcessRoute(TimestampMixin, Base):
    __tablename__ = "process_routes"
    __table_args__ = (Index("ix_process_routes_tenant_product", "tenant_id", "product_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    step_order: Mapped[int] = mapped_column(Integer)
    operation: Mapped[str] = mapped_column(String(200))
    equipment_type: Mapped[str] = mapped_column(String(200))
    cycle_time: Mapped[float] = mapped_column(Float)


# ── 订单族 ──────────────────────────────────────────────

class OrderStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class SalesOrder(TimestampMixin, Base):
    __tablename__ = "sales_orders"
    __table_args__ = (UniqueConstraint("tenant_id", "order_no", name="uq_sales_orders_tenant_order_no"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    order_no: Mapped[str] = mapped_column(String(100))
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[float] = mapped_column(Float)
    due_date: Mapped[datetime] = mapped_column(DateTime)
    priority: Mapped[str] = mapped_column(String(50), default="normal")
    status: Mapped[str] = mapped_column(String(50), default="pending")

    work_orders: Mapped[list["WorkOrder"]] = relationship(back_populates="sales_order")


class WorkOrder(TimestampMixin, Base):
    __tablename__ = "work_orders"
    __table_args__ = (UniqueConstraint("tenant_id", "order_no", name="uq_work_orders_tenant_order_no"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    order_no: Mapped[str] = mapped_column(String(100))
    sales_order_id: Mapped[int] = mapped_column(ForeignKey("sales_orders.id"))
    line_id: Mapped[int] = mapped_column(ForeignKey("production_lines.id"))
    planned_start: Mapped[datetime] = mapped_column(DateTime)
    planned_end: Mapped[datetime] = mapped_column(DateTime)
    actual_start: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    actual_end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    quantity: Mapped[float] = mapped_column(Float)
    completed_quantity: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(50), default="pending")

    sales_order: Mapped["SalesOrder"] = relationship(back_populates="work_orders")
    operations: Mapped[list["Operation"]] = relationship(back_populates="work_order")


class Operation(TimestampMixin, Base):
    __tablename__ = "operations"
    __table_args__ = (Index("ix_operations_tenant_work_order", "tenant_id", "work_order_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    work_order_id: Mapped[int] = mapped_column(ForeignKey("work_orders.id"))
    step: Mapped[int] = mapped_column(Integer)
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipment.id"))
    start_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    operator_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workers.id"), nullable=True)
    result: Mapped[str] = mapped_column(String(50), default="pending")

    work_order: Mapped["WorkOrder"] = relationship(back_populates="operations")


# ── 供应链族 ──────────────────────────────────────────────

class Supplier(TimestampMixin, Base):
    __tablename__ = "suppliers"
    __table_args__ = (Index("ix_suppliers_tenant_rating", "tenant_id", "rating"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    location: Mapped[str] = mapped_column(String(500))
    rating: Mapped[float] = mapped_column(Float, default=0)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=7)
    contact: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"
    __table_args__ = (Index("ix_customers_tenant_region", "tenant_id", "region"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    industry: Mapped[str] = mapped_column(String(200))
    region: Mapped[str] = mapped_column(String(200))


class Warehouse(TimestampMixin, Base):
    __tablename__ = "warehouses"
    __table_args__ = (Index("ix_warehouses_tenant_location", "tenant_id", "location"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    location: Mapped[str] = mapped_column(String(500))
    capacity: Mapped[float] = mapped_column(Float)
    utilization: Mapped[float] = mapped_column(Float, default=0)


class Inventory(TimestampMixin, Base):
    __tablename__ = "inventory"
    __table_args__ = (Index("ix_inventory_tenant_material_warehouse", "tenant_id", "material_id", "warehouse_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    quantity: Mapped[float] = mapped_column(Float, default=0)
    reserved: Mapped[float] = mapped_column(Float, default=0)


class ShipmentStatus(str, enum.Enum):
    PENDING = "pending"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    DELAYED = "delayed"


class Shipment(TimestampMixin, Base):
    __tablename__ = "shipments"
    __table_args__ = (Index("ix_shipments_tenant_status", "tenant_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    origin_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    destination_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    status: Mapped[str] = mapped_column(String(50), default="pending")
    eta: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    tracking_no: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


# ── 质量族 ──────────────────────────────────────────────

class InspectionType(str, enum.Enum):
    INCOMING = "incoming"
    IN_PROCESS = "in_process"
    FINAL = "final"


class Inspection(TimestampMixin, Base):
    __tablename__ = "inspections"
    __table_args__ = (Index("ix_inspections_tenant_type_result", "tenant_id", "inspection_type", "result"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    inspection_type: Mapped[str] = mapped_column(String(50))
    target_type: Mapped[str] = mapped_column(String(100))
    target_id: Mapped[int] = mapped_column(Integer)
    result: Mapped[str] = mapped_column(String(50))
    inspector_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workers.id"), nullable=True)
    inspected_at: Mapped[datetime] = mapped_column(DateTime)


class DefectSeverity(str, enum.Enum):
    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"


class Defect(TimestampMixin, Base):
    __tablename__ = "defects"
    __table_args__ = (Index("ix_defects_tenant_severity", "tenant_id", "severity"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspections.id"))
    defect_type: Mapped[str] = mapped_column(String(200))
    severity: Mapped[str] = mapped_column(String(50))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    root_cause: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    correction: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class SPCPoint(TimestampMixin, Base):
    __tablename__ = "spc_points"
    __table_args__ = (Index("ix_spc_points_tenant_parameter_time", "tenant_id", "parameter", "timestamp"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    parameter: Mapped[str] = mapped_column(String(200))
    value: Mapped[float] = mapped_column(Float)
    ucl: Mapped[float] = mapped_column(Float)
    lcl: Mapped[float] = mapped_column(Float)
    cl: Mapped[float] = mapped_column(Float)
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipment.id"))
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)


class CAPAStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    CLOSED = "closed"


class CAPA(TimestampMixin, Base):
    __tablename__ = "capa"
    __table_args__ = (Index("ix_capa_tenant_status", "tenant_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    defect_id: Mapped[int] = mapped_column(ForeignKey("defects.id"))
    action_type: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="open")
    due_date: Mapped[datetime] = mapped_column(DateTime)
    assignee_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workers.id"), nullable=True)


# ── 人员族 ──────────────────────────────────────────────

class Worker(TimestampMixin, Base):
    __tablename__ = "workers"
    __table_args__ = (Index("ix_workers_tenant_role", "tenant_id", "role"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(100))
    department: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


class DataSource(TimestampMixin, Base):
    __tablename__ = "data_sources"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_data_sources_tenant_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    source_type: Mapped[str] = mapped_column(String(100))
    connection_config: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="active")
    last_sync: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    schedule: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


class Pipeline(TimestampMixin, Base):
    __tablename__ = "pipelines"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_pipelines_tenant_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config: Mapped[str] = mapped_column(Text)
    schedule: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")


class PipelineRun(TimestampMixin, Base):
    __tablename__ = "pipeline_runs"
    __table_args__ = (Index("ix_pipeline_runs_tenant_pipeline", "tenant_id", "pipeline_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id"))
    status: Mapped[str] = mapped_column(String(50), default="running")
    started_at: Mapped[datetime] = mapped_column(DateTime)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    records_processed: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


# ── 报表族 (Phase 1) ──────────────────────────────────────

class Tenant(TimestampMixin, Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(50), default="active")
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    limits: Mapped[dict] = mapped_column(JSON, default=dict)
    opened_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    suspended_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    domains: Mapped[list["TenantDomain"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")


class TenantDomain(TimestampMixin, Base):
    __tablename__ = "tenant_domains"
    __table_args__ = (
        UniqueConstraint("domain", name="uq_tenant_domains_domain"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    domain: Mapped[str] = mapped_column(String(255), index=True)
    status: Mapped[str] = mapped_column(String(50), default="active")
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="domains")


class TenantInvite(TimestampMixin, Base):
    __tablename__ = "tenant_invites"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_tenant_invites_token_hash"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    role: Mapped[str] = mapped_column(String(50), default="member")
    token_hash: Mapped[str] = mapped_column(String(128), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    replaced_by_invite_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    invited_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)


class TenantExport(TimestampMixin, Base):
    __tablename__ = "tenant_exports"
    __table_args__ = (Index("ix_tenant_exports_tenant_status", "tenant_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    requested_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    format: Mapped[str] = mapped_column(String(20), default="zip")
    file_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class PasswordResetToken(TimestampMixin, Base):
    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_password_reset_tokens_token_hash"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Report(TimestampMixin, Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config: Mapped[str] = mapped_column(Text, default="{}")
    category: Mapped[str] = mapped_column(String(100), default="general")
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    snapshots: Mapped[list["ReportSnapshot"]] = relationship(back_populates="report")


class ReportSnapshot(TimestampMixin, Base):
    __tablename__ = "report_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"))
    config: Mapped[str] = mapped_column(Text, default="{}")
    version: Mapped[int] = mapped_column(Integer, default=1)

    report: Mapped["Report"] = relationship(back_populates="snapshots")


# ── 元数据族 (Phase 2 — 模型驱动) ───────────────────────────

class MetaModel(TimestampMixin, Base):
    __tablename__ = "meta_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    label: Mapped[str] = mapped_column(String(200))
    icon: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    table_name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)

    fields: Mapped[list["MetaField"]] = relationship(back_populates="model", cascade="all, delete-orphan")
    page_configs: Mapped[list["PageConfig"]] = relationship(back_populates="model")
    model_versions: Mapped[list["ModelVersion"]] = relationship(back_populates="model", cascade="all, delete-orphan")


class MetaField(TimestampMixin, Base):
    __tablename__ = "meta_fields"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("meta_models.id"))
    field_name: Mapped[str] = mapped_column(String(200))
    label: Mapped[str] = mapped_column(String(200))
    field_type: Mapped[str] = mapped_column(String(50), default="string")
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    searchable: Mapped[bool] = mapped_column(Boolean, default=False)
    sortable: Mapped[bool] = mapped_column(Boolean, default=False)
    visible_in_list: Mapped[bool] = mapped_column(Boolean, default=True)
    visible_in_form: Mapped[bool] = mapped_column(Boolean, default=True)
    enum_values: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    relation_config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    default_value: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    model: Mapped["MetaModel"] = relationship(back_populates="fields")


class MetaRelation(TimestampMixin, Base):
    __tablename__ = "meta_relations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_model_id: Mapped[int] = mapped_column(ForeignKey("meta_models.id"))
    target_model_id: Mapped[int] = mapped_column(ForeignKey("meta_models.id"))
    relation_type: Mapped[str] = mapped_column(String(50))
    label: Mapped[str] = mapped_column(String(200))
    foreign_key_field: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


class PageConfig(TimestampMixin, Base):
    __tablename__ = "page_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    paradigm: Mapped[str] = mapped_column(String(50), default="master-detail")
    model_id: Mapped[int] = mapped_column(ForeignKey("meta_models.id"))
    config: Mapped[str] = mapped_column(Text, default="{}")
    route_path: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)

    model: Mapped["MetaModel"] = relationship(back_populates="page_configs")


class MenuItem(TimestampMixin, Base):
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("menu_items.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    icon: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    route_path: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True)


# ── 权限族 (Phase 3) ──────────────────────────────────────

class Application(TimestampMixin, Base):
    __tablename__ = "applications"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_applications_tenant_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    icon: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    default_route: Mapped[str] = mapped_column(String(200), default="/")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(50), default="published")
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)

    menus: Mapped[list["ApplicationMenu"]] = relationship(back_populates="application", cascade="all, delete-orphan")
    roles: Mapped[list["ApplicationRole"]] = relationship(back_populates="application", cascade="all, delete-orphan")


class ApplicationMenu(TimestampMixin, Base):
    __tablename__ = "application_menus"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"))
    menu_id: Mapped[int] = mapped_column(ForeignKey("menu_items.id"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    application: Mapped["Application"] = relationship(back_populates="menus")


class ApplicationRole(TimestampMixin, Base):
    __tablename__ = "application_roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))

    application: Mapped["Application"] = relationship(back_populates="roles")


class Form(TimestampMixin, Base):
    __tablename__ = "forms"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_forms_tenant_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    model_id: Mapped[Optional[int]] = mapped_column(ForeignKey("meta_models.id"), nullable=True)
    table_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    storage_mode: Mapped[str] = mapped_column(String(50), default="dynamic")
    status: Mapped[str] = mapped_column(String(50), default="draft")
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    applications: Mapped[list["ApplicationForm"]] = relationship(back_populates="form", cascade="all, delete-orphan")
    fields: Mapped[list["FormField"]] = relationship(back_populates="form", cascade="all, delete-orphan")
    layouts: Mapped[list["FormLayout"]] = relationship(back_populates="form", cascade="all, delete-orphan")
    actions: Mapped[list["FormAction"]] = relationship(back_populates="form", cascade="all, delete-orphan")
    permissions: Mapped[list["FormPermission"]] = relationship(back_populates="form", cascade="all, delete-orphan")
    records: Mapped[list["DynamicRecord"]] = relationship(back_populates="form", cascade="all, delete-orphan")
    versions: Mapped[list["FormVersion"]] = relationship(back_populates="form", cascade="all, delete-orphan")
    workflow_bindings: Mapped[list["WorkflowBinding"]] = relationship(back_populates="form", cascade="all, delete-orphan")


class ApplicationForm(TimestampMixin, Base):
    __tablename__ = "application_forms"
    __table_args__ = (
        UniqueConstraint("application_id", "form_id", name="uq_application_forms_application_form"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"))
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"))
    alias: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    default_view: Mapped[str] = mapped_column(String(50), default="list")
    data_scope: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    allow_create: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_edit: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_delete: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_export: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    form: Mapped["Form"] = relationship(back_populates="applications")


class ApplicationMenuNode(TimestampMixin, Base):
    __tablename__ = "application_menu_nodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"))
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("application_menu_nodes.id"), nullable=True)
    node_type: Mapped[str] = mapped_column(String(50), default="form")
    title: Mapped[str] = mapped_column(String(200))
    icon: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    form_id: Mapped[Optional[int]] = mapped_column(ForeignKey("forms.id"), nullable=True)
    route_path: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    visible: Mapped[bool] = mapped_column(Boolean, default=True)
    default_entry: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)


class FormField(TimestampMixin, Base):
    __tablename__ = "form_fields"
    __table_args__ = (
        UniqueConstraint("form_id", "field_name", name="uq_form_fields_form_field_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"))
    meta_field_id: Mapped[Optional[int]] = mapped_column(ForeignKey("meta_fields.id"), nullable=True)
    field_name: Mapped[str] = mapped_column(String(200))
    label: Mapped[str] = mapped_column(String(200))
    field_type: Mapped[str] = mapped_column(String(50), default="string")
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    visible_in_list: Mapped[bool] = mapped_column(Boolean, default=True)
    visible_in_form: Mapped[bool] = mapped_column(Boolean, default=True)
    searchable: Mapped[bool] = mapped_column(Boolean, default=False)
    sortable: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    default_value: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    enum_values: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    validation: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    ui_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    form: Mapped["Form"] = relationship(back_populates="fields")


class FormLayout(TimestampMixin, Base):
    __tablename__ = "form_layouts"
    __table_args__ = (
        UniqueConstraint("form_id", "layout_type", name="uq_form_layouts_form_layout_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"))
    layout_type: Mapped[str] = mapped_column(String(50), default="list")
    config: Mapped[dict] = mapped_column(JSON, default=dict)

    form: Mapped["Form"] = relationship(back_populates="layouts")


class FormAction(TimestampMixin, Base):
    __tablename__ = "form_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"))
    action_key: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(200))
    action_type: Mapped[str] = mapped_column(String(50), default="builtin")
    config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    form: Mapped["Form"] = relationship(back_populates="actions")


class FormPermission(TimestampMixin, Base):
    __tablename__ = "form_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    action: Mapped[str] = mapped_column(String(50))
    effect: Mapped[str] = mapped_column(String(20), default="allow")
    field_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    form: Mapped["Form"] = relationship(back_populates="permissions")


class FormVersion(TimestampMixin, Base):
    __tablename__ = "form_versions"
    __table_args__ = (
        UniqueConstraint("form_id", "version", name="uq_form_versions_form_version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(50), default="published")
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    impact_report: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    published_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    form: Mapped["Form"] = relationship(back_populates="versions")


class FormCodeSequence(TimestampMixin, Base):
    """Atomic per-scope counter backing auto-encoding (料号) fields.

    One row per (tenant, form, field, period). ``next_value`` holds the last
    allocated sequence; allocation is an atomic UPDATE ... RETURNING so that
    concurrent record creation can never hand out duplicate numbers.
    ``period_key`` carries the rendered date token (e.g. ``20260612``) for
    rules whose codes embed a date and therefore reset per period.
    """

    __tablename__ = "form_code_sequences"
    __table_args__ = (
        UniqueConstraint("tenant_id", "form_id", "field_name", "period_key", name="uq_form_code_sequences_scope"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"), index=True)
    field_name: Mapped[str] = mapped_column(String(200))
    period_key: Mapped[str] = mapped_column(String(64), default="")
    next_value: Mapped[int] = mapped_column(Integer, default=0)


class DynamicRecord(TimestampMixin, Base):
    __tablename__ = "dynamic_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"))
    model_id: Mapped[Optional[int]] = mapped_column(ForeignKey("meta_models.id"), nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(50), default="active")
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    form: Mapped["Form"] = relationship(back_populates="records")


class WorkflowBinding(TimestampMixin, Base):
    __tablename__ = "workflow_bindings"
    __table_args__ = (
        UniqueConstraint("form_id", "workflow_id", "trigger_action", name="uq_workflow_bindings_form_workflow_trigger"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id"))
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflow_defs.id"))
    trigger_action: Mapped[str] = mapped_column(String(50), default="submit")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    form: Mapped["Form"] = relationship(back_populates="workflow_bindings")


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("tenant_id", "username", name="uq_users_tenant_username"),
        UniqueConstraint("tenant_id", "email", name="uq_users_tenant_email"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    username: Mapped[str] = mapped_column(String(100))
    display_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    login_failed_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    force_password_change: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_login_ip: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_secret: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    sso_provider: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    sso_subject: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)

    roles: Mapped[list["UserRole"]] = relationship(back_populates="user")
    org_memberships: Mapped[list["UserOrgMembership"]] = relationship(back_populates="user")


class OrgUnit(TimestampMixin, Base):
    __tablename__ = "org_units"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_org_units_tenant_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("org_units.id"), nullable=True, index=True)
    code: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(200))
    org_type: Mapped[str] = mapped_column(String(50), default="department")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(50), default="active")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    parent: Mapped[Optional["OrgUnit"]] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[list["OrgUnit"]] = relationship(back_populates="parent")
    memberships: Mapped[list["UserOrgMembership"]] = relationship(back_populates="org_unit")


class UserOrgMembership(TimestampMixin, Base):
    __tablename__ = "user_org_memberships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "org_unit_id", name="uq_user_org_memberships_user_org"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    org_unit_id: Mapped[int] = mapped_column(ForeignKey("org_units.id"), index=True)
    position_title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped["User"] = relationship(back_populates="org_memberships")
    org_unit: Mapped["OrgUnit"] = relationship(back_populates="memberships")


class Role(TimestampMixin, Base):
    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_roles_tenant_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    users: Mapped[list["UserRole"]] = relationship(back_populates="role")
    permissions: Mapped[list["RolePermission"]] = relationship(back_populates="role")


class UserRole(TimestampMixin, Base):
    __tablename__ = "user_roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))

    user: Mapped["User"] = relationship(back_populates="roles")
    role: Mapped["Role"] = relationship(back_populates="users")


class RolePermission(TimestampMixin, Base):
    __tablename__ = "role_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    resource_type: Mapped[str] = mapped_column(String(50))
    resource_key: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    action: Mapped[str] = mapped_column(String(50))
    effect: Mapped[str] = mapped_column(String(20), default="allow")
    data_scope: Mapped[str] = mapped_column(String(50), default="all")
    condition_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    field_rules_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    role: Mapped["Role"] = relationship(back_populates="permissions")


class UserSession(TimestampMixin, Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    login_method: Mapped[str] = mapped_column(String(50), default="local")
    ip_address: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)


class PasswordHistory(TimestampMixin, Base):
    __tablename__ = "password_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    password_hash: Mapped[str] = mapped_column(String(500))


class OidcState(TimestampMixin, Base):
    __tablename__ = "oidc_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    state: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    nonce: Mapped[str] = mapped_column(String(200))
    redirect_uri: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    consumed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


# ── 工作流族 (Phase 3) ────────────────────────────────────

class WorkflowDef(TimestampMixin, Base):
    __tablename__ = "workflow_defs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config: Mapped[str] = mapped_column(Text, default="{}")
    form_config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1)

    instances: Mapped[list["WorkflowInstance"]] = relationship(back_populates="definition")


class WorkflowDefVersion(TimestampMixin, Base):
    """Immutable snapshot of a workflow definition at a published version.

    Instances pin ``workflow_version`` at start so editing a definition can
    never reshape the steps of in-flight instances (the form layer has the
    same pattern in FormVersion).
    """

    __tablename__ = "workflow_def_versions"
    __table_args__ = (
        UniqueConstraint("workflow_id", "version", name="uq_workflow_def_versions_workflow_version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflow_defs.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    config: Mapped[str] = mapped_column(Text, default="{}")
    form_config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    published_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class WorkflowInstance(TimestampMixin, Base):
    __tablename__ = "workflow_instances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflow_defs.id"))
    workflow_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    initiator_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    form_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    workflow_state: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    definition: Mapped["WorkflowDef"] = relationship(back_populates="instances")
    approvals: Mapped[list["WorkflowApproval"]] = relationship(back_populates="instance")


class WorkflowApproval(TimestampMixin, Base):
    __tablename__ = "workflow_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("workflow_instances.id"))
    approver_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    node_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    action: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    acted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    instance: Mapped["WorkflowInstance"] = relationship(back_populates="approvals")


class Notification(TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_tenant_user_read", "tenant_id", "user_id", "is_read"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    type: Mapped[str] = mapped_column(String(50), default="info")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    resource_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    resource_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)


# ── 模型版本族 (Phase 3) ──────────────────────────────────

class ModelVersion(Base):
    __tablename__ = "model_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[int] = mapped_column(Integer, ForeignKey("meta_models.id"))
    version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[str] = mapped_column(Text)  # JSON snapshot of model + fields
    change_description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    model: Mapped["MetaModel"] = relationship(back_populates="model_versions")


# ── 审计日志 ──────────────────────────────────────────────

# ── 校验规则族 (Phase 3) ────────────────────────────────────

class Rule(Base):
    __tablename__ = "rules"
    __table_args__ = (Index("ix_rules_tenant_model_type", "tenant_id", "model_id", "rule_type"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    model_id: Mapped[int] = mapped_column(Integer, ForeignKey("meta_models.id"))
    name: Mapped[str] = mapped_column(String(100))
    rule_type: Mapped[str] = mapped_column(String(20))  # 'validation' | 'trigger' | 'visibility'
    field_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # target field
    condition: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON: {operator, value, field}
    action: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON: {type, params}
    message: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # error message
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(50))
    resource_type: Mapped[str] = mapped_column(String(100))
    resource_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    old_values: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    new_values: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ScheduledJob(TimestampMixin, Base):
    __tablename__ = "scheduled_jobs"
    __table_args__ = (Index("ix_scheduled_jobs_tenant_active", "tenant_id", "is_active"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    cron: Mapped[str] = mapped_column(String(50))
    job_type: Mapped[str] = mapped_column(String(20))
    config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class KnowledgeDocument(TimestampMixin, Base):
    __tablename__ = "knowledge_documents"
    __table_args__ = (UniqueConstraint("tenant_id", "document_id", name="uq_knowledge_documents_tenant_document_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    document_id: Mapped[str] = mapped_column(String(100), index=True)
    source_file_name: Mapped[str] = mapped_column(String(500))
    source_type: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(300))
    markdown_content: Mapped[str] = mapped_column(Text)
    ocr_result: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    permission_scope: Mapped[str] = mapped_column(String(50), default="enterprise")
    owner_user_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    source_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="indexed")


class KnowledgeChunk(TimestampMixin, Base):
    __tablename__ = "knowledge_chunks"
    __table_args__ = (UniqueConstraint("tenant_id", "chunk_id", name="uq_knowledge_chunks_tenant_chunk_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    chunk_id: Mapped[str] = mapped_column(String(100), index=True)
    document_id: Mapped[str] = mapped_column(String(100), index=True)
    title: Mapped[str] = mapped_column(String(300))
    chunk_text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    source_location: Mapped[str] = mapped_column(String(200), default="section:1")
    permission_scope: Mapped[str] = mapped_column(String(50), default="enterprise")
    status: Mapped[str] = mapped_column(String(50), default="indexed")


class KnowledgeIngestionJob(TimestampMixin, Base):
    __tablename__ = "knowledge_ingestion_jobs"
    __table_args__ = (UniqueConstraint("tenant_id", "job_id", name="uq_knowledge_ingestion_jobs_tenant_job_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    job_id: Mapped[str] = mapped_column(String(100), index=True)
    asset_id: Mapped[str] = mapped_column(String(100), index=True)
    document_id: Mapped[str] = mapped_column(String(100), index=True)
    status: Mapped[str] = mapped_column(String(50), default="running")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class KnowledgeExtractionResult(TimestampMixin, Base):
    __tablename__ = "knowledge_extraction_results"
    __table_args__ = (UniqueConstraint("tenant_id", "job_id", name="uq_knowledge_extraction_results_tenant_job_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    job_id: Mapped[str] = mapped_column(String(100), index=True)
    document_id: Mapped[str] = mapped_column(String(100), index=True)
    domain: Mapped[str] = mapped_column(String(100), default="manufacturing")
    prompt_name: Mapped[str] = mapped_column(String(200), default="manufacturing_ontology_v1")
    model_name: Mapped[str] = mapped_column(String(200), default="rules-ontology-extractor")
    status: Mapped[str] = mapped_column(String(50), default="completed")
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    approved_result: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    quality_report: Mapped[dict] = mapped_column(JSON, default=dict)
    committed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class KnowledgeObjectLink(TimestampMixin, Base):
    __tablename__ = "knowledge_object_links"
    __table_args__ = (Index("ix_knowledge_object_links_tenant_object", "tenant_id", "object_type", "object_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    document_id: Mapped[str] = mapped_column(String(100), index=True)
    job_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    object_type: Mapped[str] = mapped_column(String(100))
    object_id: Mapped[str] = mapped_column(String(200))
    object_name: Mapped[str] = mapped_column(String(300))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    source_location: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="candidate")


class OntologyObject(TimestampMixin, Base):
    __tablename__ = "ontology_objects"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_ontology_objects_tenant_code"),
        Index("ix_ontology_objects_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(120))
    domain: Mapped[str] = mapped_column(String(100), default="manufacturing")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    source_type: Mapped[str] = mapped_column(String(80), default="manual")
    source_ref: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    review_status: Mapped[str] = mapped_column(String(50), default="approved")
    reviewed_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    updated_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)

    fields: Mapped[list["OntologyField"]] = relationship(back_populates="object", cascade="all, delete-orphan")


class OntologyField(TimestampMixin, Base):
    __tablename__ = "ontology_fields"
    __table_args__ = (
        UniqueConstraint("tenant_id", "object_id", "code", name="uq_ontology_fields_tenant_object_code"),
        Index("ix_ontology_fields_tenant_object", "tenant_id", "object_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    object_id: Mapped[int] = mapped_column(ForeignKey("ontology_objects.id"))
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(120))
    field_type: Mapped[str] = mapped_column(String(80), default="string")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    searchable: Mapped[bool] = mapped_column(Boolean, default=False)
    sortable: Mapped[bool] = mapped_column(Boolean, default=False)
    visible_in_list: Mapped[bool] = mapped_column(Boolean, default=True)
    visible_in_form: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(50), default="published")
    version: Mapped[int] = mapped_column(Integer, default=1)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    source_type: Mapped[str] = mapped_column(String(80), default="manual")
    source_ref: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)

    object: Mapped["OntologyObject"] = relationship(back_populates="fields")


class OntologyRelation(TimestampMixin, Base):
    __tablename__ = "ontology_relations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_ontology_relations_tenant_code"),
        Index("ix_ontology_relations_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    code: Mapped[str] = mapped_column(String(180))
    name: Mapped[str] = mapped_column(String(200))
    relation_type: Mapped[str] = mapped_column(String(100), default="RELATED_TO")
    source_object_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ontology_objects.id"), nullable=True)
    target_object_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ontology_objects.id"), nullable=True)
    source_object_code: Mapped[str] = mapped_column(String(120))
    target_object_code: Mapped[str] = mapped_column(String(120))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    graph_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    source_type: Mapped[str] = mapped_column(String(80), default="manual")
    source_ref: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    review_status: Mapped[str] = mapped_column(String(50), default="approved")
    reviewed_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class OntologyMapping(TimestampMixin, Base):
    __tablename__ = "ontology_mappings"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "source_system",
            "source_entity",
            "source_field",
            "target_object_code",
            "target_field_code",
            name="uq_ontology_mappings_source_target",
        ),
        Index("ix_ontology_mappings_tenant_target", "tenant_id", "target_object_code", "target_field_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    source_system: Mapped[str] = mapped_column(String(120))
    source_type: Mapped[str] = mapped_column(String(80), default="database")
    source_entity: Mapped[str] = mapped_column(String(200))
    source_field: Mapped[str] = mapped_column(String(200))
    source_field_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    target_object_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ontology_objects.id"), nullable=True)
    target_field_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ontology_fields.id"), nullable=True)
    target_object_code: Mapped[str] = mapped_column(String(120))
    target_field_code: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(50), default="candidate")
    evidence: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class OntologyCandidate(TimestampMixin, Base):
    __tablename__ = "ontology_candidates"
    __table_args__ = (
        UniqueConstraint("tenant_id", "candidate_key", name="uq_ontology_candidates_tenant_key"),
        Index("ix_ontology_candidates_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    candidate_key: Mapped[str] = mapped_column(String(300))
    candidate_type: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(300))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    source_type: Mapped[str] = mapped_column(String(80), default="metadata")
    source_ref: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(50), default="pending_review")
    merge_target_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    reviewed_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class OntologyVersion(TimestampMixin, Base):
    __tablename__ = "ontology_versions"
    __table_args__ = (Index("ix_ontology_versions_tenant_version", "tenant_id", "version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="published")
    published_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class OntologyPublishLog(TimestampMixin, Base):
    __tablename__ = "ontology_publish_logs"
    __table_args__ = (Index("ix_ontology_publish_logs_tenant_action", "tenant_id", "action"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    action: Mapped[str] = mapped_column(String(50))
    resource_type: Mapped[str] = mapped_column(String(80))
    resource_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    actor_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class OntologyMappingLayout(TimestampMixin, Base):
    __tablename__ = "ontology_mapping_layouts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "object_code", "source_scope", name="uq_ontology_mapping_layout_scope"),
        Index("ix_ontology_mapping_layout_tenant_object", "tenant_id", "object_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    object_code: Mapped[str] = mapped_column(String(120))
    source_scope: Mapped[str] = mapped_column(String(120), default="all")
    layout: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class DataSourceMetadata(TimestampMixin, Base):
    __tablename__ = "data_source_metadata"
    __table_args__ = (
        UniqueConstraint("tenant_id", "source_id", "entity_name", name="uq_data_source_metadata_source_entity"),
        Index("ix_data_source_metadata_tenant_source", "tenant_id", "source_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("data_sources.id"))
    source_type: Mapped[str] = mapped_column(String(80), default="database")
    entity_name: Mapped[str] = mapped_column(String(200))
    entity_label: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    fields: Mapped[list] = mapped_column(JSON, default=list)
    relationships: Mapped[list] = mapped_column(JSON, default=list)
    sample_rows: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(50), default="scanned")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class DataSourceSyncStatus(TimestampMixin, Base):
    __tablename__ = "data_source_sync_status"
    __table_args__ = (
        UniqueConstraint("tenant_id", "source_id", name="uq_data_source_sync_status_tenant_source"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("data_sources.id"))
    status: Mapped[str] = mapped_column(String(50), default="idle")
    last_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tables_scanned: Mapped[int] = mapped_column(Integer, default=0)
    fields_scanned: Mapped[int] = mapped_column(Integer, default=0)


class AIConversation(TimestampMixin, Base):
    __tablename__ = "ai_conversations"
    __table_args__ = (UniqueConstraint("tenant_id", "conversation_id", name="uq_ai_conversations_tenant_conversation_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    conversation_id: Mapped[str] = mapped_column(String(100), index=True)
    user_id: Mapped[str] = mapped_column(String(100), index=True)
    page: Mapped[str] = mapped_column(String(100), default="knowledge-center")
    document_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(50), default="active")
    last_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class AIMessage(TimestampMixin, Base):
    __tablename__ = "ai_messages"
    __table_args__ = (UniqueConstraint("tenant_id", "message_id", name="uq_ai_messages_tenant_message_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    message_id: Mapped[str] = mapped_column(String(100), index=True)
    conversation_id: Mapped[str] = mapped_column(String(100), ForeignKey("ai_conversations.conversation_id"), index=True)
    role: Mapped[str] = mapped_column(String(30))
    content: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    model_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    usage: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="completed")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class AIAgentRun(TimestampMixin, Base):
    __tablename__ = "ai_agent_runs"
    __table_args__ = (UniqueConstraint("tenant_id", "run_id", name="uq_ai_agent_runs_tenant_run_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    run_id: Mapped[str] = mapped_column(String(100), index=True)
    conversation_id: Mapped[str] = mapped_column(String(100), ForeignKey("ai_conversations.conversation_id"), index=True)
    user_message_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    assistant_message_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="completed")
    mode: Mapped[str] = mapped_column(String(50), default="qa")
    input_message: Mapped[str] = mapped_column(Text)
    answer: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    items: Mapped[list] = mapped_column(JSON, default=list)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    actions: Mapped[list] = mapped_column(JSON, default=list)
    risk_level: Mapped[str] = mapped_column(String(50), default="low")
    requires_confirmation: Mapped[bool] = mapped_column(Boolean, default=False)
    confirmation_payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)


class AIDraft(TimestampMixin, Base):
    __tablename__ = "ai_drafts"
    __table_args__ = (UniqueConstraint("tenant_id", "draft_id", name="uq_ai_drafts_tenant_draft_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    draft_id: Mapped[str] = mapped_column(String(100), index=True)
    skill: Mapped[str] = mapped_column(String(200), index=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    run_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class AIToolCall(TimestampMixin, Base):
    __tablename__ = "ai_tool_calls"
    __table_args__ = (UniqueConstraint("tenant_id", "call_id", name="uq_ai_tool_calls_tenant_call_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, default=1, index=True)
    call_id: Mapped[str] = mapped_column(String(100), index=True)
    run_id: Mapped[str] = mapped_column(String(100), ForeignKey("ai_agent_runs.run_id"), index=True)
    tool_name: Mapped[str] = mapped_column(String(200))
    skill_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    input: Mapped[dict] = mapped_column(JSON, default=dict)
    output: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="completed")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class AIMemoryEntry(TimestampMixin, Base):
    __tablename__ = "ai_memory_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    memory_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    conversation_id: Mapped[Optional[str]] = mapped_column(String(100), ForeignKey("ai_conversations.conversation_id"), nullable=True, index=True)
    tenant_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    user_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    page: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    document_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    run_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    user_message_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    assistant_message_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    source_type: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    source_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    scope: Mapped[str] = mapped_column(String(50), default="conversation")
    memory_type: Mapped[str] = mapped_column(String(80), default="turn_summary")
    key: Mapped[str] = mapped_column(String(200))
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    importance_score: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    visibility: Mapped[str] = mapped_column(String(50), default="private")
    sensitivity: Mapped[str] = mapped_column(String(50), default="normal")
    redaction_status: Mapped[str] = mapped_column(String(50), default="clean")
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_accessed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    content_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    vault_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    exported_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    export_checksum: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="active")


class AIConfirmationToken(Base):
    __tablename__ = "ai_confirmation_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    user_key: Mapped[str] = mapped_column(String(100), default="")
    risk_level: Mapped[str] = mapped_column(String(20), default="low")
    actions_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
