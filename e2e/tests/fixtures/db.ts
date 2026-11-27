import mysql, { type Pool } from 'mysql2/promise'

// The e2e harness publishes the MariaDB container on a host port (E2E_DB_HOST_PORT) and the API
// on E2E_API_PORT so the tests can seed the database with past-dated history directly and then ask
// the API to reconcile the cached spool state — the documented repair operation.

const DB_HOST = '127.0.0.1'
const DB_PORT = Number(process.env.E2E_DB_HOST_PORT ?? 13307)
const DB_USER = 'filament'
const DB_PASS = 'filament'
const DB_NAME = 'filament'
const API_BASE = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 18080}`

let pool: Pool | null = null
async function db(): Promise<Pool> {
  if (!pool) {
    pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 2,
    })
  }
  return pool
}

export type SpoolEventKind = 'Created' | 'Opened' | 'Print' | 'Adjustment' | 'Finished'
// Matches Filament.Core.Domain.SpoolEventKind (Created=0, Opened=1, Print=2, Adjustment=3, Finished=4).
const KIND_VALUE: Record<SpoolEventKind, number> = {
  Created: 0,
  Opened: 1,
  Print: 2,
  Adjustment: 3,
  Finished: 4,
}

export interface SeedEvent {
  kind: SpoolEventKind
  deltaGrams: number
  occurredAt: Date
  disabled?: boolean
}

/** Formats a Date as a UTC 'YYYY-MM-DD HH:MM:SS.mmm' string for a MySQL datetime(6) column. */
function toUtcSql(dt: Date): string {
  return dt.toISOString().replace('T', ' ').slice(0, 23)
}

/**
 * Wipes all inventory rows (in FK order) so tests start from — and leave — a clean database.
 * spool_events goes first: its ProjectPrintId reference to project_prints is restrict, so the
 * project side can only be cleared once the events are gone.
 */
export async function resetInventory(): Promise<void> {
  const p = await db()
  await p.query('DELETE FROM spool_events')
  await p.query('DELETE FROM print_project_types')
  await p.query('DELETE FROM project_prints')
  await p.query('DELETE FROM print_projects')
  await p.query('DELETE FROM spools')
  await p.query('DELETE FROM filament_types')
}

/** Asks the API to recompute every spool's cached status/remaining/timestamps from its events. */
export async function reevaluate(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/spools/reevaluate`, { method: 'POST' })
  if (!res.ok) throw new Error(`reevaluate failed: ${res.status} ${res.statusText}`)
}

async function ensureType(
  p: Pool,
  typeId: string,
  defaultNetWeightGrams: number,
  emptySpoolWeightGrams: number,
  brand = 'SeedBrand',
  material = 'PLA',
  type = 'SeedType',
  color = 'SeedColor',
): Promise<void> {
  const [rows] = await p.query('SELECT Id FROM filament_types WHERE Id = ?', [typeId])
  if ((rows as unknown[]).length > 0) return
  await p.query(
    `INSERT INTO filament_types
      (Id, Brand, Material, Type, Color, ColorHex, DefaultNetWeightGrams, EmptySpoolWeightGrams, Notes, CreatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [typeId, brand, material, type, color, '#ff7a18', defaultNetWeightGrams, emptySpoolWeightGrams, toUtcSql(new Date())],
  )
}

/**
 * Inserts a filament type row directly, so it can be picked in the UI creation flow. Facet
 * fields default to the shared seed values; override them when a test needs distinguishable
 * facet values (e.g. to exercise the facet filters).
 */
export async function seedType(opts: {
  id: string
  defaultNetWeightGrams?: number
  emptySpoolWeightGrams?: number
  brand?: string
  material?: string
  type?: string
  color?: string
}): Promise<void> {
  const p = await db()
  await ensureType(
    p,
    opts.id,
    opts.defaultNetWeightGrams ?? 1000,
    opts.emptySpoolWeightGrams ?? 200,
    opts.brand,
    opts.material,
    opts.type,
    opts.color,
  )
}

/**
 * Inserts a spool plus its (past-dated) event history directly, then re-evaluates so the cached
 * status/remaining weights line up. `events` must include a `Created` event; every other event the
 * caller wants is supplied here. The filament type is created on demand when no `typeId` is given.
 */
export async function seedSpool(opts: {
  id: string
  initialNetGrams: number
  createdAt: Date
  typeId?: string
  events: SeedEvent[]
}): Promise<void> {
  const p = await db()
  const typeId = opts.typeId ?? `T${opts.id.replace(/[^0-9A-Za-z]/g, '').slice(0, 7) || '0000000'}`
  await ensureType(p, typeId, opts.initialNetGrams, 200)

  await p.query('DELETE FROM spool_events WHERE SpoolId = ?', [opts.id])
  await p.query('DELETE FROM spools WHERE Id = ?', [opts.id])
  await p.query(
    `INSERT INTO spools
      (Id, FilamentTypeId, InitialNetGrams, RemainingGrams, Status, CreatedAt)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [opts.id, typeId, opts.initialNetGrams, opts.initialNetGrams, toUtcSql(opts.createdAt)],
  )
  for (const e of opts.events) {
    await p.query(
      `INSERT INTO spool_events (SpoolId, Kind, DeltaGrams, IsDisabled, OccurredAt)
        VALUES (?, ?, ?, ?, ?)`,
      [opts.id, KIND_VALUE[e.kind], e.deltaGrams, e.disabled ? 1 : 0, toUtcSql(e.occurredAt)],
    )
  }
  await reevaluate()
}

/**
 * Inserts a print project (and its type lines) directly. Every referenced filament type is
 * created on demand, so this composes with unseeded type ids. `id` defaults to a slug of the
 * title so tests can address the project without tracking the generated value.
 */
export async function seedPrintProject(opts: {
  id?: string
  title: string
  description?: string
  url?: string
  archived?: boolean
  archivedAt?: Date
  createdAt: Date
  types: { typeId: string; grams: number }[]
}): Promise<string> {
  const p = await db()
  for (const t of opts.types) await ensureType(p, t.typeId, 1000, 200)
  const id = opts.id ?? `PP-${opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
  await p.query('DELETE FROM print_project_types WHERE ProjectId = ?', [id])
  await p.query('DELETE FROM project_prints WHERE ProjectId = ?', [id])
  await p.query('DELETE FROM print_projects WHERE Id = ?', [id])
  await p.query(
    `INSERT INTO print_projects
       (Id, Title, Description, Url, IsArchived, ArchivedAt, CreatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, opts.title, opts.description ?? null, opts.url ?? null,
     opts.archived ? 1 : 0, opts.archived ? toUtcSql(opts.archivedAt ?? opts.createdAt) : null,
     toUtcSql(opts.createdAt)],
  )
  for (const t of opts.types) {
    await p.query(
      'INSERT INTO print_project_types (ProjectId, FilamentTypeId, Grams) VALUES (?, ?, ?)',
      [id, t.typeId, t.grams],
    )
  }
  return id
}

/**
 * Inserts a project print plus its linked spool Print event (the row a confirmed project print
 * would create) and re-evaluates, so cached spool state reflects the consumption. The spool must
 * already exist. `printId` defaults to a fresh id derived from the project and a row counter.
 */
export async function seedProjectPrint(opts: {
  projectId: string
  printId?: string
  spoolId: string
  grams: number
  occurredAt: Date
  disabled?: boolean
}): Promise<string> {
  const p = await db()
  const [titleRows] = await p.query('SELECT Title FROM print_projects WHERE Id = ?', [opts.projectId])
  const title = (titleRows as Array<{ Title: string }>)[0]?.Title
  if (title === undefined) throw new Error(`seedProjectPrint: unknown project ${opts.projectId}`)

  const [countRows] = await p.query('SELECT COUNT(*) AS n FROM project_prints WHERE ProjectId = ?', [opts.projectId])
  const n = (countRows as Array<{ n: number }>)[0].n
  const printId = opts.printId ?? `PPR-${opts.projectId}-${n}`

  await p.query('DELETE FROM spool_events WHERE ProjectPrintId = ?', [printId])
  await p.query('DELETE FROM project_prints WHERE Id = ?', [printId])
  await p.query(
    `INSERT INTO project_prints (Id, ProjectId, OccurredAt, IsDisabled) VALUES (?, ?, ?, ?)`,
    [printId, opts.projectId, toUtcSql(opts.occurredAt), opts.disabled ? 1 : 0],
  )
  await p.query(
    `INSERT INTO spool_events (SpoolId, Kind, DeltaGrams, IsDisabled, OccurredAt, ProjectName, ProjectPrintId)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [opts.spoolId, KIND_VALUE.Print, -opts.grams, opts.disabled ? 1 : 0, toUtcSql(opts.occurredAt),
     title, printId],
  )
  await reevaluate()
  return printId
}
