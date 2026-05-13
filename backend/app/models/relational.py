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
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ── 工厂族 ──────────────────────────────────────────────

class Factory(TimestampMixin, Base):
    __tablename__ = "factories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    location: Mapped[str] = mapped_column(String(500))
    capacity: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(50), default="active")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    workshops: Mapped[list["Workshop"]] = relationship(back_populates="factory")


class Workshop(TimestampMixin, Base):
    __tablename__ = "workshops"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    factory_id: Mapped[int] = mapped_column(ForeignKey("factories.id"))
    area: Mapped[float] = mapped_column(Float, default=0)
    workshop_type: Mapped[str] = mapped_column(String(100), default="production")

    factory: Mapped["Factory"] = relationship(back_populates="workshops")
    production_lines: Mapped[list["ProductionLine"]] = relationship(back_populates="workshop")


class ProductionLine(TimestampMixin, Base):
    __tablename__ = "production_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipment.id"))
    sensor_type: Mapped[str] = mapped_column(String(100))
    unit: Mapped[str] = mapped_column(String(50))
    sampling_rate: Mapped[int] = mapped_column(Integer, default=60)

    equipment: Mapped["Equipment"] = relationship(back_populates="sensors")
    readings: Mapped[list["SensorReading"]] = relationship(back_populates="sensor")


class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sensor_id: Mapped[int] = mapped_column(ForeignKey("sensors.id"))
    value: Mapped[float] = mapped_column(Float)
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)

    sensor: Mapped["Sensor"] = relationship(back_populates="readings")


# ── 产品族 ──────────────────────────────────────────────

class Product(TimestampMixin, Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    sku: Mapped[str] = mapped_column(String(100), unique=True)
    category: Mapped[str] = mapped_column(String(100))
    specs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(50), default="个")


class Material(TimestampMixin, Base):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    material_type: Mapped[str] = mapped_column(String(100))
    specs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(50), default="个")
    safety_stock: Mapped[float] = mapped_column(Float, default=0)


class BOM(TimestampMixin, Base):
    __tablename__ = "bom"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id"))
    quantity: Mapped[float] = mapped_column(Float)
    level: Mapped[int] = mapped_column(Integer, default=1)


class ProcessRoute(TimestampMixin, Base):
    __tablename__ = "process_routes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_no: Mapped[str] = mapped_column(String(100), unique=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[float] = mapped_column(Float)
    due_date: Mapped[datetime] = mapped_column(DateTime)
    priority: Mapped[str] = mapped_column(String(50), default="normal")
    status: Mapped[str] = mapped_column(String(50), default="pending")

    work_orders: Mapped[list["WorkOrder"]] = relationship(back_populates="sales_order")


class WorkOrder(TimestampMixin, Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_no: Mapped[str] = mapped_column(String(100), unique=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    location: Mapped[str] = mapped_column(String(500))
    rating: Mapped[float] = mapped_column(Float, default=0)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=7)
    contact: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    industry: Mapped[str] = mapped_column(String(200))
    region: Mapped[str] = mapped_column(String(200))


class Warehouse(TimestampMixin, Base):
    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    location: Mapped[str] = mapped_column(String(500))
    capacity: Mapped[float] = mapped_column(Float)
    utilization: Mapped[float] = mapped_column(Float, default=0)


class Inventory(TimestampMixin, Base):
    __tablename__ = "inventory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspections.id"))
    defect_type: Mapped[str] = mapped_column(String(200))
    severity: Mapped[str] = mapped_column(String(50))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    root_cause: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    correction: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class SPCPoint(TimestampMixin, Base):
    __tablename__ = "spc_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    defect_id: Mapped[int] = mapped_column(ForeignKey("defects.id"))
    action_type: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="open")
    due_date: Mapped[datetime] = mapped_column(DateTime)
    assignee_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workers.id"), nullable=True)


# ── 人员族 ──────────────────────────────────────────────

class Worker(TimestampMixin, Base):
    __tablename__ = "workers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(100))
    department: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


class DataSource(TimestampMixin, Base):
    __tablename__ = "data_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    source_type: Mapped[str] = mapped_column(String(100))
    connection_config: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="active")
    last_sync: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    schedule: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)


class Pipeline(TimestampMixin, Base):
    __tablename__ = "pipelines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config: Mapped[str] = mapped_column(Text)
    schedule: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")


class PipelineRun(TimestampMixin, Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pipeline_id: Mapped[int] = mapped_column(ForeignKey("pipelines.id"))
    status: Mapped[str] = mapped_column(String(50), default="running")
    started_at: Mapped[datetime] = mapped_column(DateTime)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    records_processed: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


# ── 报表族 (Phase 1) ──────────────────────────────────────

class Report(TimestampMixin, Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("menu_items.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    icon: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    route_path: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True)


# ── 权限族 (Phase 3) ──────────────────────────────────────

class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)

    roles: Mapped[list["UserRole"]] = relationship(back_populates="user")


class Role(TimestampMixin, Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    label: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    users: Mapped[list["UserRole"]] = relationship(back_populates="role")
    permissions: Mapped[list["RolePermission"]] = relationship(back_populates="role")


class UserRole(TimestampMixin, Base):
    __tablename__ = "user_roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))

    user: Mapped["User"] = relationship(back_populates="roles")
    role: Mapped["Role"] = relationship(back_populates="users")


class RolePermission(TimestampMixin, Base):
    __tablename__ = "role_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    resource_type: Mapped[str] = mapped_column(String(50))
    resource_key: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    action: Mapped[str] = mapped_column(String(50))

    role: Mapped["Role"] = relationship(back_populates="permissions")


# ── 工作流族 (Phase 3) ────────────────────────────────────

class WorkflowDef(TimestampMixin, Base):
    __tablename__ = "workflow_defs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config: Mapped[str] = mapped_column(Text, default="{}")
    form_config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1)

    instances: Mapped[list["WorkflowInstance"]] = relationship(back_populates="definition")


class WorkflowInstance(TimestampMixin, Base):
    __tablename__ = "workflow_instances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflow_defs.id"))
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
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
    user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(50))
    resource_type: Mapped[str] = mapped_column(String(100))
    resource_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    old_values: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    new_values: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ScheduledJob(TimestampMixin, Base):
    __tablename__ = "scheduled_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    cron: Mapped[str] = mapped_column(String(50))
    job_type: Mapped[str] = mapped_column(String(20))
    config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
