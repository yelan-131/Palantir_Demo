\set ON_ERROR_STOP on

SELECT 'CREATE ROLE mf_readonly LOGIN PASSWORD ''readonly_demo_123'''
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mf_readonly')\gexec
ALTER ROLE mf_readonly WITH LOGIN PASSWORD 'readonly_demo_123';

SELECT 'CREATE DATABASE mf_erp_core'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'mf_erp_core')\gexec
SELECT 'CREATE DATABASE mf_mes_execution'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'mf_mes_execution')\gexec
SELECT 'CREATE DATABASE mf_qms_quality'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'mf_qms_quality')\gexec
SELECT 'CREATE DATABASE mf_scm_supply'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'mf_scm_supply')\gexec
SELECT 'CREATE DATABASE mf_wms_inventory'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'mf_wms_inventory')\gexec

\connect mf_erp_core
DROP SCHEMA IF EXISTS source CASCADE;
CREATE SCHEMA source;
SET search_path TO source;
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
  material_id text NOT NULL,
  quantity numeric(12,2) NOT NULL,
  promised_date date NOT NULL,
  po_status text NOT NULL
);
CREATE TABLE bill_of_materials (
  product_id text NOT NULL,
  component_id text NOT NULL,
  quantity_per numeric(12,4) NOT NULL,
  PRIMARY KEY (product_id, component_id)
);
INSERT INTO materials VALUES
('MAT-SOLDER-S12','S12 lead-free solder paste','raw_material','kg',120,'Zhang Wei','active'),
('MAT-PCBA-CTRL','Control module PCBA','semi_finished','pcs',350,'Li Na','active'),
('PRD-CTRL-A','Electric control module A','finished_goods','pcs',180,'Wang Tao','active');
INSERT INTO customer_orders VALUES
('SO-8821','Northwind Auto','PRD-CTRL-A',800,'2026-06-05','high','confirmed'),
('SO-8834','Haixin Robotics','PRD-CTRL-A',420,'2026-06-12','normal','planned');
INSERT INTO purchase_orders VALUES
('PO-7721','SUP-BEICHEN','MAT-SOLDER-S12',260,'2026-05-30','released'),
('PO-7726','SUP-LONGRUI','MAT-PCBA-CTRL',500,'2026-06-02','confirmed');
INSERT INTO bill_of_materials VALUES
('PRD-CTRL-A','MAT-PCBA-CTRL',1),
('PRD-CTRL-A','MAT-SOLDER-S12',0.018);
GRANT USAGE ON SCHEMA source TO mf_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA source TO mf_readonly;

\connect mf_mes_execution
DROP SCHEMA IF EXISTS source CASCADE;
CREATE SCHEMA source;
SET search_path TO source;
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
  work_order_id text NOT NULL,
  equipment_id text NOT NULL,
  event_type text NOT NULL,
  event_time timestamp NOT NULL,
  description text
);
INSERT INTO equipment VALUES
('EQ-SMT-03','SMT-03 Reflow Oven','SMT-A','RF-9000','running',91.5),
('EQ-AOI-02','AOI-02 Optical Inspection','SMT-A','AOI-X7','running',96.2),
('EQ-ASM-01','Assembly Station 01','ASM-B','ASM-2.1','maintenance',72.4);
INSERT INTO work_orders VALUES
('WO-260521-017','SO-8821','PRD-CTRL-A','SMT-A',800,356,'in_progress','2026-05-26 08:30:00'),
('WO-260521-022','SO-8834','PRD-CTRL-A','ASM-B',420,0,'released',NULL);
INSERT INTO operation_events VALUES
('EVT-9001','WO-260521-017','EQ-SMT-03','temperature_warning','2026-05-26 10:14:00','Zone 5 temperature drift exceeded threshold'),
('EVT-9002','WO-260521-017','EQ-AOI-02','defect_detected','2026-05-26 10:27:00','AOI detected solder void on BGA pins');
GRANT USAGE ON SCHEMA source TO mf_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA source TO mf_readonly;

\connect mf_qms_quality
DROP SCHEMA IF EXISTS source CASCADE;
CREATE SCHEMA source;
SET search_path TO source;
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
  defect_id text NOT NULL,
  action_owner text NOT NULL,
  action_type text NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL
);
INSERT INTO quality_defects VALUES
('DEF-260526-001','WO-260521-017','PRD-CTRL-A','BGA solder void','major','2026-05-26 10:27:00','open'),
('DEF-260526-002','WO-260521-017','PRD-CTRL-A','label offset','minor','2026-05-26 11:02:00','contained');
INSERT INTO inspections VALUES
('INSP-AOI-8841','LOT-CTRL-A-0526','AOI',80,76,4,'Chen Min'),
('INSP-FQC-8842','LOT-CTRL-A-0526','FQC',32,31,1,'Zhao Rui');
INSERT INTO capa_actions VALUES
('CAPA-072','DEF-260526-001','Quality Engineer','batch quarantine and reflow profile review','2026-05-29','in_progress');
GRANT USAGE ON SCHEMA source TO mf_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA source TO mf_readonly;

\connect mf_scm_supply
DROP SCHEMA IF EXISTS source CASCADE;
CREATE SCHEMA source;
SET search_path TO source;
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
  supplier_id text NOT NULL,
  material_id text NOT NULL,
  quantity numeric(12,2) NOT NULL,
  eta timestamp NOT NULL,
  shipment_status text NOT NULL
);
CREATE TABLE supply_risks (
  risk_id text PRIMARY KEY,
  supplier_id text NOT NULL,
  risk_type text NOT NULL,
  severity text NOT NULL,
  mitigation text NOT NULL
);
INSERT INTO suppliers VALUES
('SUP-BEICHEN','Beichen Electronic Materials','solder paste','medium',92.3,88.5),
('SUP-LONGRUI','Longrui Precision Components','pcba','low',96.8,94.4);
INSERT INTO shipments VALUES
('SHP-260526-12','SUP-BEICHEN','MAT-SOLDER-S12',260,'2026-05-30 16:00:00','in_transit'),
('SHP-260526-21','SUP-LONGRUI','MAT-PCBA-CTRL',500,'2026-06-02 10:00:00','confirmed');
INSERT INTO supply_risks VALUES
('RISK-044','SUP-BEICHEN','quality trend','medium','tighten incoming inspection for S12 solder paste batches');
GRANT USAGE ON SCHEMA source TO mf_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA source TO mf_readonly;

\connect mf_wms_inventory
DROP SCHEMA IF EXISTS source CASCADE;
CREATE SCHEMA source;
SET search_path TO source;
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
  material_id text NOT NULL,
  supplier_id text,
  received_at timestamp NOT NULL,
  expiry_date date,
  quality_status text NOT NULL
);
CREATE TABLE inventory_movements (
  movement_id text PRIMARY KEY,
  material_id text NOT NULL,
  movement_type text NOT NULL,
  quantity numeric(12,2) NOT NULL,
  reference_doc text NOT NULL,
  moved_at timestamp NOT NULL
);
INSERT INTO inventory_balances VALUES
('MAT-SOLDER-S12','WH-01',148.5,42.0,106.5,'2026-05-26 09:30:00'),
('MAT-PCBA-CTRL','WH-02',620,356,264,'2026-05-26 09:35:00');
INSERT INTO material_lots VALUES
('LOT-S12-7781','MAT-SOLDER-S12','SUP-BEICHEN','2026-05-20 14:20:00','2026-08-20','hold'),
('LOT-PCBA-3412','MAT-PCBA-CTRL','SUP-LONGRUI','2026-05-22 11:00:00',NULL,'released');
INSERT INTO inventory_movements VALUES
('MOV-9901','MAT-SOLDER-S12','issue',18.0,'WO-260521-017','2026-05-26 08:10:00'),
('MOV-9902','MAT-PCBA-CTRL','issue',356,'WO-260521-017','2026-05-26 08:12:00');
GRANT USAGE ON SCHEMA source TO mf_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA source TO mf_readonly;
