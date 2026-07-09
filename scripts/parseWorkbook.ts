/**
 * parseWorkbook.ts — Excel → JSON → Prisma → SQLite import pipeline.
 *
 *   Excel Workbook  →  XLSX Parser  →  JSON Objects  →  Prisma Seed  →  SQLite
 *
 * The workbook (data/MSX_..._.xlsx) is the single source of truth. Records are
 * NOT hardcoded. Rows are read per worksheet, column names are mapped to Prisma
 * fields (workbookMappings.ts), lookups are resolved with Prisma `connect`, and
 * records are inserted in strict dependency order.
 *
 * Run directly:   npm run import-workbook
 * Reuse in seed:  import { runImport } from '../scripts/parseWorkbook.js'
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import {
  SHEET_NAMES,
  opportunityMapping,
  milestoneMapping,
  statusHistoryMapping,
  recommendationMapping,
  approvalMapping,
  noteMapping,
  dealTeamMapping,
  notificationMapping,
  runLogMapping,
  auditLogMapping,
  snapshotMapping,
  type FieldMap,
  type FieldType,
} from './workbookMappings.js';

const prisma = new PrismaClient();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK_PATH =
  process.env.WORKBOOK_PATH ??
  path.resolve(__dirname, '../data/MSX_Mirror_Necessary_Tables_Import_10_More_Entries.xlsx');

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/** Treats null/undefined/empty/"---" as blank. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' || t === '---' || t.toLowerCase() === 'n/a';
  }
  return false;
}

function toStringOrNull(value: unknown): string | null {
  if (isBlank(value)) return null;
  return String(value).trim();
}

/** Yes/No (and common variants) → boolean. Blank → null. */
function convertBool(value: unknown): boolean | null {
  if (isBlank(value)) return null;
  if (typeof value === 'boolean') return value;
  const t = String(value).trim().toLowerCase();
  if (['yes', 'true', 'y', '1'].includes(t)) return true;
  if (['no', 'false', 'n', '0'].includes(t)) return false;
  return null;
}

/** Parses decimals/integers, stripping currency symbols and thousands separators. */
function convertNumber(value: unknown, integer = false): number | null {
  if (isBlank(value)) return null;
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else {
    const cleaned = String(value).replace(/[$,\s]/g, '');
    n = Number(cleaned);
  }
  if (Number.isNaN(n)) return null;
  return integer ? Math.round(n) : n;
}

/** Excel serial date → JS Date (Excel epoch 1899-12-30). */
export function excelDateToJSDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

/**
 * Converts any supported date representation to a JS Date (or null):
 *   - real Date objects
 *   - Excel serial numbers (e.g. 46210)
 *   - ISO strings "2026-07-03"
 *   - datetime strings "2026-07-03 09:00"
 */
export function convertExcelDate(value: unknown): Date | null {
  if (isBlank(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return excelDateToJSDate(value);

  const raw = String(value).trim();
  // Pure numeric string => Excel serial.
  if (/^\d+(\.\d+)?$/.test(raw)) return excelDateToJSDate(Number(raw));

  // Normalize "YYYY-MM-DD HH:mm" to ISO by inserting a 'T'.
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(raw) ? raw.replace(/\s+/, 'T') : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function convertByType(value: unknown, type: FieldType): unknown {
  switch (type) {
    case 'int':
      return convertNumber(value, true);
    case 'float':
      return convertNumber(value, false);
    case 'bool':
      return convertBool(value);
    case 'date':
    case 'datetime':
      return convertExcelDate(value);
    case 'string':
    default:
      return toStringOrNull(value);
  }
}

/** Builds a Prisma scalar-data object from a row using a field map. */
function mapRow(row: Row, map: FieldMap): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [column, target] of Object.entries(map)) {
    const raw = row[column];
    if (typeof target === 'string') {
      data[target] = toStringOrNull(raw);
    } else {
      data[target.to] = convertByType(raw, target.type);
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Relationship `connect` helpers
// ---------------------------------------------------------------------------

function connectOpportunity(row: Row, column = 'Opportunity') {
  const name = toStringOrNull(row[column]);
  return name ? { connect: { opportunityName: name } } : undefined;
}
function connectMilestone(row: Row, column: string) {
  const id = toStringOrNull(row[column]);
  return id ? { connect: { milestoneBusinessId: id } } : undefined;
}
function connectRecommendation(row: Row, column: string) {
  const id = toStringOrNull(row[column]);
  return id ? { connect: { recommendationBusinessId: id } } : undefined;
}

// ---------------------------------------------------------------------------
// Workbook access
// ---------------------------------------------------------------------------

let workbook: XLSX.WorkBook | null = null;

function getWorkbook(): XLSX.WorkBook {
  if (!workbook) workbook = XLSX.readFile(WORKBOOK_PATH);
  return workbook;
}

function readSheet(sheetName: string): Row[] {
  const wb = getWorkbook();
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.warn(`⚠️  Worksheet "${sheetName}" not found — skipping.`);
    return [];
  }
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });
}

/** Runs a per-row creator with error isolation; returns the success count. */
async function loadRows(
  label: string,
  rows: Row[],
  create: (row: Row, index: number) => Promise<unknown>,
): Promise<number> {
  let ok = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await create(rows[i], i);
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ ${label} row ${i + 1} failed: ${msg}`);
    }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Loaders (in dependency order)
// ---------------------------------------------------------------------------

export async function loadOpportunities() {
  const rows = readSheet(SHEET_NAMES.opportunity);
  return loadRows('Opportunity', rows, async (row) => {
    const data = mapRow(row, opportunityMapping) as { opportunityBusinessId?: string; opportunityName?: string };
    if (!data.opportunityBusinessId || !data.opportunityName) throw new Error('missing Opportunity ID / Name');
    await prisma.opportunity.create({ data: data as never });
  });
}

export async function loadMilestones() {
  const rows = readSheet(SHEET_NAMES.milestone);
  return loadRows('OpportunityMilestone', rows, async (row) => {
    const data = mapRow(row, milestoneMapping);
    const opportunity = connectOpportunity(row);
    if (!opportunity) throw new Error('missing/unknown Opportunity lookup');
    await prisma.opportunityMilestone.create({ data: { ...data, opportunity } as never });
  });
}

export async function loadStatusHistory() {
  const rows = readSheet(SHEET_NAMES.statusHistory);
  return loadRows('MilestoneStatusHistory', rows, async (row) => {
    const data = mapRow(row, statusHistoryMapping);
    const milestone = connectMilestone(row, 'Milestone');
    if (!milestone) throw new Error('missing/unknown Milestone lookup');
    const opportunity = connectOpportunity(row);
    await prisma.milestoneStatusHistory.create({ data: { ...data, milestone, opportunity } as never });
  });
}

export async function loadRecommendations() {
  const rows = readSheet(SHEET_NAMES.recommendation);
  return loadRows('AiMilestoneRecommendation', rows, async (row) => {
    const data = mapRow(row, recommendationMapping);
    const opportunity = connectOpportunity(row);
    const relatedMilestone = connectMilestone(row, 'Related Milestone');
    await prisma.aiMilestoneRecommendation.create({ data: { ...data, opportunity, relatedMilestone } as never });
  });
}

export async function loadApprovalRequests() {
  const rows = readSheet(SHEET_NAMES.approval);
  return loadRows('ApprovalRequest', rows, async (row) => {
    const data = mapRow(row, approvalMapping);
    const opportunity = connectOpportunity(row);
    const relatedRecommendation = connectRecommendation(row, 'Related Recommendation');
    const relatedMilestone = connectMilestone(row, 'Related Milestone');
    await prisma.approvalRequest.create({
      data: { ...data, opportunity, relatedRecommendation, relatedMilestone } as never,
    });
  });
}

export async function loadCollaborationNotes() {
  const rows = readSheet(SHEET_NAMES.note);
  return loadRows('CollaborationNote', rows, async (row) => {
    const data = mapRow(row, noteMapping);
    const opportunity = connectOpportunity(row);
    const relatedMilestone = connectMilestone(row, 'Related Milestone');
    await prisma.collaborationNote.create({ data: { ...data, opportunity, relatedMilestone } as never });
  });
}

export async function loadDealTeamMembers() {
  const rows = readSheet(SHEET_NAMES.dealTeam);
  return loadRows('DealTeamMember', rows, async (row) => {
    const data = mapRow(row, dealTeamMapping);
    const opportunity = connectOpportunity(row);
    if (!opportunity) throw new Error('missing/unknown Opportunity lookup');
    await prisma.dealTeamMember.create({ data: { ...data, opportunity } as never });
  });
}

export async function loadNotifications() {
  const rows = readSheet(SHEET_NAMES.notification);
  return loadRows('AgentNotification', rows, async (row) => {
    const data = mapRow(row, notificationMapping);
    const opportunity = connectOpportunity(row);
    const relatedMilestone = connectMilestone(row, 'Related Milestone');
    await prisma.agentNotification.create({ data: { ...data, opportunity, relatedMilestone } as never });
  });
}

export async function loadRunLogs() {
  const rows = readSheet(SHEET_NAMES.runLog);
  return loadRows('AgentRunLog', rows, async (row) => {
    const data = mapRow(row, runLogMapping);
    const opportunity = connectOpportunity(row);
    const relatedMilestone = connectMilestone(row, 'Related Milestone');
    await prisma.agentRunLog.create({ data: { ...data, opportunity, relatedMilestone } as never });
  });
}

export async function loadAuditLogs() {
  const rows = readSheet(SHEET_NAMES.auditLog);
  return loadRows('AgentActionAuditLog', rows, async (row) => {
    const data = mapRow(row, auditLogMapping);
    const opportunity = connectOpportunity(row);
    const relatedMilestone = connectMilestone(row, 'Related Milestone');
    const relatedRecommendation = connectRecommendation(row, 'Related Recommendation');
    await prisma.agentActionAuditLog.create({
      data: { ...data, opportunity, relatedMilestone, relatedRecommendation } as never,
    });
  });
}

export async function loadSnapshots() {
  const rows = readSheet(SHEET_NAMES.snapshot);
  return loadRows('DashboardMetricSnapshot', rows, async (row) => {
    const data = mapRow(row, snapshotMapping) as { snapshotName?: string };
    if (!data.snapshotName) throw new Error('missing Snapshot Name');
    await prisma.dashboardMetricSnapshot.create({ data: data as never });
  });
}

// ---------------------------------------------------------------------------
// Reset + orchestration
// ---------------------------------------------------------------------------

/** Deletes all rows (children first) so the import is idempotent. */
export async function resetDatabase() {
  console.log('Resetting tables...');
  await prisma.agentActionAuditLog.deleteMany();
  await prisma.agentRunLog.deleteMany();
  await prisma.agentNotification.deleteMany();
  await prisma.dealTeamMember.deleteMany();
  await prisma.collaborationNote.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.aiMilestoneRecommendation.deleteMany();
  await prisma.milestoneStatusHistory.deleteMany();
  await prisma.opportunityMilestone.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.dashboardMetricSnapshot.deleteMany();
}

export interface ImportSummary {
  Opportunities: number;
  Milestones: number;
  'Status History': number;
  Recommendations: number;
  Approvals: number;
  Notes: number;
  'Team Members': number;
  Notifications: number;
  'Run Logs': number;
  'Audit Logs': number;
  'Dashboard Snapshots': number;
}

/** Runs the full pipeline: reset (optional) then load every sheet in order. */
export async function runImport({ reset = true }: { reset?: boolean } = {}): Promise<ImportSummary> {
  console.log(`Reading workbook: ${WORKBOOK_PATH}`);
  if (reset) await resetDatabase();

  const summary: ImportSummary = {
    Opportunities: await loadOpportunities(),
    Milestones: await loadMilestones(),
    'Status History': await loadStatusHistory(),
    Recommendations: await loadRecommendations(),
    Approvals: await loadApprovalRequests(),
    Notes: await loadCollaborationNotes(),
    'Team Members': await loadDealTeamMembers(),
    Notifications: await loadNotifications(),
    'Run Logs': await loadRunLogs(),
    'Audit Logs': await loadAuditLogs(),
    'Dashboard Snapshots': await loadSnapshots(),
  };

  printSummary(summary);
  return summary;
}

function printSummary(summary: ImportSummary) {
  const line = '====================================';
  console.log(`\n${line}`);
  console.log('Import Complete');
  console.log(line);
  for (const [label, count] of Object.entries(summary)) {
    console.log(`${label}: ${count}`);
  }
  console.log(`${line}\n`);
}

// Run when invoked directly (e.g. `npm run import-workbook`).
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  runImport()
    .catch((err) => {
      console.error('Import failed:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
