"""Create demo source databases for testing data-source onboarding.

The script is intentionally idempotent: rerunning it recreates only the demo
schemas/tables inside the demo databases and keeps the server itself intact.

Default admin connection:
  host=localhost port=5432 user=manufoundry password=manufoundry123 db=postgres
"""

from __future__ import annotations

import argparse
import os
from collections.abc import Iterable

try:
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
except ImportError as exc:  # pragma: no cover - user-facing guard
    raise SystemExit(
        "psycopg2 is required. Install backend dependencies or run inside the backend container."
    ) from exc


DEMO_PASSWORD = "readonly_demo_123"


DATABASES = {
    "mf_erp_core": {
        "comment": "ERP core planning, orders, material master, and BOM data",
        "role": "mf_erp_readonly",
        "schema": """
            CREATE TABLE materials (
              material_id text PRIMARY KEY,
              material_name text NOT NULL,
              material_type text NOT NULL,
              uom text NOT NULL,
              safety_stock numeric(12,2) NOT NULL,
              planner text NOT NULL,
              status text NOT NULL
            );
            CREATE TABLE customer_orders (
              order_id text PRIMARY KEY,
              customer_name text NOT NULL,
              product_id text NOT NULL,
              quantity integer NOT NULL,
              due_date date NOT NULL,
              priority text NOT NULL,
              order_status text NOT NULL
            );
            CREATE TABLE purchase_orders (
              po_id text PRIMARY KEY,
              supplier_id text NOT NULL,
              material_id text NOT NULL REFERENCES materials(material_id),
              quantity numeric(12,2) NOT NULL,
              promised_date date NOT NULL,
              po_status text NOT NULL
            );
            CREATE TABLE bill_of_materials (
              product_id text NOT NULL REFERENCES materials(material_id),
              component_id text NOT NULL REFERENCES materials(material_id),
              quantity_per numeric(12,4) NOT NULL,
              PRIMARY KEY (product_id, component_id)
            );
        """,
        "inserts": [
            "INSERT INTO materials VALUES "
            "('MAT-SOLDER-S12','S12 lead-free solder paste','raw_material','kg',120,'Zhang Wei','active'),"
            "('MAT-PCBA-CTRL','Control module PCBA','semi_finished','pcs',350,'Li Na','active'),"
            "('PRD-CTRL-A','Electric control module A','finished_goods','pcs',180,'Wang Tao','active')",
            "INSERT INTO customer_orders VALUES "
            "('SO-8821','Northwind Auto','PRD-CTRL-A',800,'2026-06-05','high','confirmed'),"
            "('SO-8834','Haixin Robotics','PRD-CTRL-A',420,'2026-06-12','normal','planned')",
            "INSERT INTO purchase_orders VALUES "
            "('PO-7721','SUP-BEICHEN','MAT-SOLDER-S12',260,'2026-05-30','released'),"
            "('PO-7726','SUP-LONGRUI','MAT-PCBA-CTRL',500,'2026-06-02','confirmed')",
            "INSERT INTO bill_of_materials VALUES "
            "('PRD-CTRL-A','MAT-PCBA-CTRL',1),"
            "('PRD-CTRL-A','MAT-SOLDER-S12',0.018)",
        ],
    },
    "mf_mes_execution": {
        "comment": "MES execution data for equipment, work orders, routing, and shopfloor events",
        "role": "mf_mes_readonly",
        "schema": """
            CREATE TABLE equipment (
              equipment_id text PRIMARY KEY,
              equipment_name text NOT NULL,
              line_id text NOT NULL,
              model text NOT NULL,
              status text NOT NULL,
              health_score numeric(5,2) NOT NULL
            );
            CREATE TABLE work_orders (
              work_order_id text PRIMARY KEY,
              order_id text NOT NULL,
              product_id text NOT NULL,
              line_id text NOT NULL,
              planned_qty integer NOT NULL,
              completed_qty integer NOT NULL,
              status text NOT NULL,
              started_at timestamp
            );
            CREATE TABLE operation_events (
              event_id text PRIMARY KEY,
              work_order_id text NOT NULL REFERENCES work_orders(work_order_id),
              equipment_id text NOT NULL REFERENCES equipment(equipment_id),
              event_type text NOT NULL,
              event_time timestamp NOT NULL,
              description text
            );
        """,
        "inserts": [
            "INSERT INTO equipment VALUES "
            "('EQ-SMT-03','SMT-03 Reflow Oven','SMT-A','RF-9000','running',91.5),"
            "('EQ-AOI-02','AOI-02 Optical Inspection','SMT-A','AOI-X7','running',96.2),"
            "('EQ-ASM-01','Assembly Station 01','ASM-B','ASM-2.1','maintenance',72.4)",
            "INSERT INTO work_orders VALUES "
            "('WO-260521-017','SO-8821','PRD-CTRL-A','SMT-A',800,356,'in_progress','2026-05-26 08:30:00'),"
            "('WO-260521-022','SO-8834','PRD-CTRL-A','ASM-B',420,0,'released',NULL)",
            "INSERT INTO operation_events VALUES "
            "('EVT-9001','WO-260521-017','EQ-SMT-03','temperature_warning','2026-05-26 10:14:00','Zone 5 temperature drift exceeded threshold'),"
            "('EVT-9002','WO-260521-017','EQ-AOI-02','defect_detected','2026-05-26 10:27:00','AOI detected solder void on BGA pins')",
        ],
    },
    "mf_qms_quality": {
        "comment": "QMS quality defects, inspections, CAPA, and audit findings",
        "role": "mf_qms_readonly",
        "schema": """
            CREATE TABLE quality_defects (
              defect_id text PRIMARY KEY,
              work_order_id text NOT NULL,
              product_id text NOT NULL,
              defect_type text NOT NULL,
              severity text NOT NULL,
              detected_at timestamp NOT NULL,
              status text NOT NULL
            );
            CREATE TABLE inspections (
              inspection_id text PRIMARY KEY,
              lot_id text NOT NULL,
              inspection_type text NOT NULL,
              sample_size integer NOT NULL,
              pass_count integer NOT NULL,
              fail_count integer NOT NULL,
              inspector text NOT NULL
            );
            CREATE TABLE capa_actions (
              capa_id text PRIMARY KEY,
              defect_id text NOT NULL REFERENCES quality_defects(defect_id),
              action_owner text NOT NULL,
              action_type text NOT NULL,
              due_date date NOT NULL,
              status text NOT NULL
            );
        """,
        "inserts": [
            "INSERT INTO quality_defects VALUES "
            "('DEF-260526-001','WO-260521-017','PRD-CTRL-A','BGA solder void','major','2026-05-26 10:27:00','open'),"
            "('DEF-260526-002','WO-260521-017','PRD-CTRL-A','label offset','minor','2026-05-26 11:02:00','contained')",
            "INSERT INTO inspections VALUES "
            "('INSP-AOI-8841','LOT-CTRL-A-0526','AOI',80,76,4,'Chen Min'),"
            "('INSP-FQC-8842','LOT-CTRL-A-0526','FQC',32,31,1,'Zhao Rui')",
            "INSERT INTO capa_actions VALUES "
            "('CAPA-072','DEF-260526-001','Quality Engineer','batch quarantine and reflow profile review','2026-05-29','in_progress')",
        ],
    },
    "mf_scm_supply": {
        "comment": "SCM supplier, material risk, shipment, and procurement collaboration data",
        "role": "mf_scm_readonly",
        "schema": """
            CREATE TABLE suppliers (
              supplier_id text PRIMARY KEY,
              supplier_name text NOT NULL,
              category text NOT NULL,
              risk_level text NOT NULL,
              on_time_rate numeric(5,2) NOT NULL,
              quality_score numeric(5,2) NOT NULL
            );
            CREATE TABLE shipments (
              shipment_id text PRIMARY KEY,
              supplier_id text NOT NULL REFERENCES suppliers(supplier_id),
              material_id text NOT NULL,
              quantity numeric(12,2) NOT NULL,
              eta timestamp NOT NULL,
              shipment_status text NOT NULL
            );
            CREATE TABLE supply_risks (
              risk_id text PRIMARY KEY,
              supplier_id text NOT NULL REFERENCES suppliers(supplier_id),
              risk_type text NOT NULL,
              severity text NOT NULL,
              mitigation text NOT NULL
            );
        """,
        "inserts": [
            "INSERT INTO suppliers VALUES "
            "('SUP-BEICHEN','Beichen Electronic Materials','solder paste','medium',92.3,88.5),"
            "('SUP-LONGRUI','Longrui Precision Components','pcba','low',96.8,94.4)",
            "INSERT INTO shipments VALUES "
            "('SHP-260526-12','SUP-BEICHEN','MAT-SOLDER-S12',260,'2026-05-30 16:00:00','in_transit'),"
            "('SHP-260526-21','SUP-LONGRUI','MAT-PCBA-CTRL',500,'2026-06-02 10:00:00','confirmed')",
            "INSERT INTO supply_risks VALUES "
            "('RISK-044','SUP-BEICHEN','quality trend','medium','tighten incoming inspection for S12 solder paste batches')",
        ],
    },
    "mf_wms_inventory": {
        "comment": "WMS inventory, warehouse lots, reservations, and movements",
        "role": "mf_wms_readonly",
        "schema": """
            CREATE TABLE inventory_balances (
              material_id text PRIMARY KEY,
              warehouse text NOT NULL,
              on_hand numeric(12,2) NOT NULL,
              reserved numeric(12,2) NOT NULL,
              available numeric(12,2) NOT NULL,
              updated_at timestamp NOT NULL
            );
            CREATE TABLE material_lots (
              lot_id text PRIMARY KEY,
              material_id text NOT NULL REFERENCES inventory_balances(material_id),
              supplier_id text,
              received_at timestamp NOT NULL,
              expiry_date date,
              quality_status text NOT NULL
            );
            CREATE TABLE inventory_movements (
              movement_id text PRIMARY KEY,
              material_id text NOT NULL REFERENCES inventory_balances(material_id),
              movement_type text NOT NULL,
              quantity numeric(12,2) NOT NULL,
              reference_doc text NOT NULL,
              moved_at timestamp NOT NULL
            );
        """,
        "inserts": [
            "INSERT INTO inventory_balances VALUES "
            "('MAT-SOLDER-S12','WH-01',148.5,42.0,106.5,'2026-05-26 09:30:00'),"
            "('MAT-PCBA-CTRL','WH-02',620,356,264,'2026-05-26 09:35:00')",
            "INSERT INTO material_lots VALUES "
            "('LOT-S12-7781','MAT-SOLDER-S12','SUP-BEICHEN','2026-05-20 14:20:00','2026-08-20','hold'),"
            "('LOT-PCBA-3412','MAT-PCBA-CTRL','SUP-LONGRUI','2026-05-22 11:00:00',NULL,'released')",
            "INSERT INTO inventory_movements VALUES "
            "('MOV-9901','MAT-SOLDER-S12','issue',18.0,'WO-260521-017','2026-05-26 08:10:00'),"
            "('MOV-9902','MAT-PCBA-CTRL','issue',356,'WO-260521-017','2026-05-26 08:12:00')",
        ],
    },
    "mf_crm_sales": {
        "comment": "CRM customer, contact, sales order, and service-ticket data",
        "role": "mf_crm_readonly",
        "schema": """
            CREATE TABLE customers (
              customer_id text PRIMARY KEY,
              customer_name text NOT NULL,
              industry text NOT NULL,
              region text NOT NULL,
              tier text NOT NULL,
              status text NOT NULL
            );
            CREATE TABLE customer_contacts (
              contact_id text PRIMARY KEY,
              customer_id text NOT NULL REFERENCES customers(customer_id),
              contact_name text NOT NULL,
              role text NOT NULL,
              email text NOT NULL,
              phone text
            );
            CREATE TABLE sales_orders (
              order_id text PRIMARY KEY,
              customer_id text NOT NULL REFERENCES customers(customer_id),
              product_id text NOT NULL,
              quantity integer NOT NULL,
              due_date date NOT NULL,
              order_status text NOT NULL
            );
            CREATE TABLE service_tickets (
              ticket_id text PRIMARY KEY,
              customer_id text NOT NULL REFERENCES customers(customer_id),
              order_id text REFERENCES sales_orders(order_id),
              issue_type text NOT NULL,
              severity text NOT NULL,
              opened_at timestamp NOT NULL,
              status text NOT NULL
            );
        """,
        "inserts": [
            "INSERT INTO customers VALUES "
            "('CUS-NORTHWIND','Northwind Auto','Automotive','East China','A','active'),"
            "('CUS-HAIXIN','Haixin Robotics','Industrial Robotics','South China','B','active')",
            "INSERT INTO customer_contacts VALUES "
            "('CNT-1001','CUS-NORTHWIND','Mia Chen','Supply Chain Manager','mia.chen@northwind.example','13800001001'),"
            "('CNT-1002','CUS-HAIXIN','Jason Liu','Operations Director','jason.liu@haixin.example','13800001002')",
            "INSERT INTO sales_orders VALUES "
            "('SO-8821','CUS-NORTHWIND','PRD-CTRL-A',800,'2026-06-05','confirmed'),"
            "('SO-8834','CUS-HAIXIN','PRD-CTRL-A',420,'2026-06-12','planned')",
            "INSERT INTO service_tickets VALUES "
            "('TCK-260526-01','CUS-NORTHWIND','SO-8821','delivery risk','major','2026-05-26 15:20:00','open')",
        ],
    },
}


def source_roles() -> list[str]:
    return sorted(str(spec["role"]) for spec in DATABASES.values())


def selected_databases(args: argparse.Namespace) -> dict[str, dict[str, object]]:
    if not args.only:
        return DATABASES
    selected = {}
    for name in args.only:
        if name not in DATABASES:
            raise SystemExit(f"Unknown demo source database: {name}")
        selected[name] = DATABASES[name]
    return selected


def connect(dbname: str, args: argparse.Namespace):
    return psycopg2.connect(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        dbname=dbname,
    )


def execute_many(cur, statements: Iterable[str]) -> None:
    for statement in statements:
        statement = statement.strip()
        if statement:
            cur.execute(statement)


def create_database_and_role(args: argparse.Namespace, databases: dict[str, dict[str, object]]) -> None:
    conn = connect(args.admin_db, args)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    try:
        with conn.cursor() as cur:
            selected_roles = sorted(str(spec["role"]) for spec in databases.values())
            for role in selected_roles:
                cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,))
                if not cur.fetchone():
                    cur.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD %s").format(sql.Identifier(role)), (DEMO_PASSWORD,))
                else:
                    cur.execute(sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD %s").format(sql.Identifier(role)), (DEMO_PASSWORD,))

            for dbname, spec in databases.items():
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,))
                if not cur.fetchone():
                    cur.execute(
                        sql.SQL("CREATE DATABASE {} OWNER {}").format(
                            sql.Identifier(dbname),
                            sql.Identifier(args.user),
                        )
                    )
                cur.execute(sql.SQL("REVOKE CONNECT ON DATABASE {} FROM PUBLIC").format(sql.Identifier(dbname)))
                for role in selected_roles:
                    cur.execute(sql.SQL("REVOKE CONNECT ON DATABASE {} FROM {}").format(sql.Identifier(dbname), sql.Identifier(role)))
                cur.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(sql.Identifier(dbname), sql.Identifier(args.user)))
                cur.execute(
                    sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                        sql.Identifier(dbname),
                        sql.Identifier(str(spec["role"])),
                    )
                )
    finally:
        conn.close()


def seed_database(dbname: str, spec: dict[str, object], args: argparse.Namespace, roles_to_revoke: list[str]) -> None:
    conn = connect(dbname, args)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("DROP SCHEMA IF EXISTS source CASCADE")
                cur.execute("CREATE SCHEMA source")
                cur.execute("SET search_path TO source")
                execute_many(cur, str(spec["schema"]).split(";"))
                execute_many(cur, spec["inserts"])  # type: ignore[arg-type]
                cur.execute(
                    sql.SQL("COMMENT ON DATABASE {} IS %s").format(sql.Identifier(dbname)),
                    (spec["comment"],),
                )
                source_role = str(spec["role"])
                cur.execute("REVOKE ALL ON SCHEMA source FROM PUBLIC")
                cur.execute("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA source FROM PUBLIC")
                for role in roles_to_revoke:
                    cur.execute(sql.SQL("REVOKE ALL ON SCHEMA source FROM {}").format(sql.Identifier(role)))
                    cur.execute(sql.SQL("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA source FROM {}").format(sql.Identifier(role)))
                cur.execute(sql.SQL("GRANT USAGE ON SCHEMA source TO {}").format(sql.Identifier(source_role)))
                cur.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA source TO {}").format(sql.Identifier(source_role)))
                cur.execute(sql.SQL("ALTER DEFAULT PRIVILEGES IN SCHEMA source GRANT SELECT ON TABLES TO {}").format(sql.Identifier(source_role)))
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("POSTGRES_HOST", "localhost"))
    parser.add_argument("--port", type=int, default=int(os.getenv("POSTGRES_PORT", "5432")))
    parser.add_argument("--user", default=os.getenv("POSTGRES_USER", "manufoundry"))
    parser.add_argument("--password", default=os.getenv("POSTGRES_PASSWORD", "manufoundry123"))
    parser.add_argument("--admin-db", default=os.getenv("POSTGRES_ADMIN_DB", "postgres"))
    parser.add_argument("--only", action="append", help="Create/seed only this demo database. Can be used more than once.")
    args = parser.parse_args()

    databases = selected_databases(args)
    create_database_and_role(args, databases)
    selected_roles = sorted(str(spec["role"]) for spec in databases.values())
    for dbname, spec in databases.items():
        seed_database(dbname, spec, args, selected_roles)

    print("Created demo source databases:")
    for dbname, spec in databases.items():
        print(f"- {dbname}: {spec['comment']}")
    print("\nReadonly connection for the onboarding wizard:")
    print(f"  host={args.host}")
    print(f"  port={args.port}")
    print("  schema=source")
    for dbname, spec in databases.items():
        print(f"  {dbname}: username={spec['role']} password={DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
