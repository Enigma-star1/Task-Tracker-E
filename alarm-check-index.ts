// ============================================================
// ENIGMA OUTPUT TRACKER - ALARM CHECK EDGE FUNCTION
// File path: supabase/functions/alarm-check/index.ts
//
// Runs every minute via pg_cron.
// - Base tasks: reads public.tasks
// - Custom/recurring tasks: reads tracker_state blobs
// - Meeting keyword tasks: alerts at T-30, T-20, T-10, T-0
// - High priority tasks: alerts at T-90, T-60, T-30, T-0
// - Low priority tasks: alerts at T-0 only
// - Completed tasks and skipped days do not alert
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NTFY_TOPIC       = Deno.env.get('NTFY_TOPIC') || 'enigma-tracker-default'
const NTFY_BASE        = 'https://ntfy.sh'

const MEETING_OFFSETS = [30, 20, 10, 0]
const HIGH_OFFSETS = [90, 60, 30, 0]
const LOW_OFFSETS = [0]

const BRAND_TAGS: Record<string, string> = {
  cp:     'briefcase',
  tratun: 'oil_drum',
  studio: 'art',
  pray:   'pray',
  meet:   'calendar,alarm_clock',
  school: 'books'
}

const BRAND_NAMES: Record<string, string> = {
  cp:     'CareerPaddy',
  tratun: 'Tratun',
  studio: 'Enigma Studio',
  pray:   'Praying Scripture',
  meet:   'Meeting',
  school: 'School'
}

function safeHeader(value: string): string {
  return (value || '').replace(/[^\x20-\x7E]/g, '').trim() || 'ENIGMA'
}

function getNigeriaTime() {
  const now = new Date()
  const wat = new Date(now.getTime() + 60 * 60 * 1000)
  return {
    hh:      String(wat.getUTCHours()).padStart(2, '0'),
    mm:      String(wat.getUTCMinutes()).padStart(2, '0'),
    dateStr: `${wat.getUTCFullYear()}-${String(wat.getUTCMonth()+1).padStart(2,'0')}-${String(wat.getUTCDate()).padStart(2,'0')}`,
    dayKey:  ['sun','mon','tue','wed','thu','fri','sat'][wat.getUTCDay()]
  }
}

function parseTimeString(t: string): string | null {
  if (!t) return null
  let s = t.toLowerCase().replace(/\s+/g, '')
  const isPm = s.includes('pm'), isAm = s.includes('am')
  const hasMeridiem = isPm || isAm
  s = s.replace('pm','').replace('am','').replace(/[^0-9:]/g,'')
  if (!s) return null
  let h = 0, m = 0
  if (s.includes(':')) {
    const p = s.split(':')
    h = parseInt(p[0], 10)
    m = parseInt(p[1], 10)
  } else {
    h = parseInt(s, 10)
  }
  if (isNaN(h) || isNaN(m)) return null
  if (!hasMeridiem) {
    // Treat common bare evening times like "5:40" as 5:40pm.
    // 8-11 stay morning by default; use pm in the task if you mean night.
    if (h >= 1 && h <= 7) h += 12
    if (h < 0 || h > 23 || m < 0 || m > 59) return null
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
  }
  if (isPm && h < 12) h += 12
  if (isAm && h === 12) h = 0
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
}

function subtractMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number)
  let total = h * 60 + m - minutes
  if (total < 0) total += 1440
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`
}

function getSaturdayAnchor(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getUTCDay()
  const diff = day === 6 ? 0 : (day + 1)
  d.setUTCDate(d.getUTCDate() - diff)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
}

function scopedStateId(id: string, weekKey: string): string {
  return `${weekKey}__${id}`
}

function formatLead(offsetMins: number): string {
  if (offsetMins === 0) return 'NOW'
  if (offsetMins === 60) return 'in 1h'
  if (offsetMins === 90) return 'in 1h 30m'
  return `in ${offsetMins}m`
}

async function fireNotification(title: string, message: string, priority: string, tags: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
    method: 'POST',
    headers: new Headers({
      'Title':        safeHeader(title),
      'Priority':     safeHeader(priority),
      'Tags':         safeHeader(tags),
      'Content-Type': 'text/plain'
    }),
    body: safeHeader(message)
  })
  const body = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, body }
}

interface Task {
  id: string
  day_key?: string
  dayKey?: string
  time_str?: string
  time?: string
  task_text?: string
  text?: string
  brand?: string
  is_meeting?: boolean
  is_counter?: boolean
  isCounter?: boolean
  taskType?: string
  task_type?: string
  alertPriority?: string
  alert_priority?: string
  active?: boolean
}

function taskText(task: Task): string {
  return task.task_text || task.text || ''
}

function taskTime(task: Task): string {
  return task.time_str || task.time || ''
}

function taskBrand(task: Task): string {
  return task.brand || 'cp'
}

function isMeetingTask(task: Task): boolean {
  if (task.is_meeting === true) return true
  const text = `${taskText(task)} ${taskTime(task)}`.toLowerCase()
  return /\b(meeting|meet|call|interview|appointment|session|consultation|briefing)\b/.test(text)
}

function getTaskAlertPriority(task: Task): 'meeting' | 'high' | 'low' | 'none' {
  if (isMeetingTask(task)) return 'meeting'

  const explicit = (task.alertPriority || task.alert_priority || 'auto').toLowerCase()
  if (explicit === 'none' || explicit === 'high' || explicit === 'low') return explicit as 'none' | 'high' | 'low'

  // Backward compatibility: old school alarm behavior becomes high priority.
  if (taskBrand(task) === 'school') return 'high'

  const hasTime = parseTimeString(taskTime(task)) !== null
  if (!hasTime) return 'none'

  return 'low'
}

function getAlertOffsets(priority: string): number[] {
  if (priority === 'meeting') return MEETING_OFFSETS
  if (priority === 'high') return HIGH_OFFSETS
  if (priority === 'low') return LOW_OFFSETS
  return []
}

function getAlertTitle(priority: string, brand: string, offsetMins: number): string {
  if (priority === 'meeting') return offsetMins === 0 ? 'ENIGMA: Meeting now' : `ENIGMA: Meeting ${formatLead(offsetMins)}`
  if (priority === 'high') return offsetMins === 0 ? 'ENIGMA: High priority now' : `ENIGMA: High priority ${formatLead(offsetMins)}`
  return `ENIGMA: ${BRAND_NAMES[brand] || brand}`
}

function getAlertTags(priority: string, brand: string): string {
  if (priority === 'meeting') return BRAND_TAGS.meet
  if (priority === 'high') return brand === 'school' ? BRAND_TAGS.school : 'warning,alarm_clock'
  return BRAND_TAGS[brand] || 'bell'
}

function getNtfyPriority(priority: string): string {
  return priority === 'meeting' || priority === 'high' ? 'urgent' : 'high'
}

async function alreadyDone(supabase: any, taskId: string, weekKey: string): Promise<boolean> {
  const ids = [scopedStateId(taskId, weekKey), taskId]
  const { data } = await supabase
    .from('tracker_state')
    .select('id, is_done')
    .in('id', ids)
    .eq('week_key', weekKey)

  if (!Array.isArray(data)) return false
  const scoped = data.find((row: any) => row.id === scopedStateId(taskId, weekKey))
  if (scoped) return scoped.is_done === true
  const legacy = data.find((row: any) => row.id === taskId)
  return legacy?.is_done === true
}

async function dayIsSkipped(supabase: any, dayKey: string, weekKey: string): Promise<boolean> {
  const legacyId = `skip_day_${dayKey}`
  const ids = [scopedStateId(legacyId, weekKey), legacyId]
  const { data } = await supabase
    .from('tracker_state')
    .select('id, is_done')
    .in('id', ids)
    .eq('week_key', weekKey)

  if (!Array.isArray(data)) return false
  const scoped = data.find((row: any) => row.id === scopedStateId(legacyId, weekKey))
  if (scoped) return scoped.is_done === true
  const legacy = data.find((row: any) => row.id === legacyId)
  return legacy?.is_done === true
}

async function alertAlreadyFired(supabase: any, alertId: string): Promise<boolean> {
  const { data } = await supabase
    .from('alerts_fired')
    .select('id')
    .eq('id', alertId)
    .maybeSingle()

  return Boolean(data)
}

Deno.serve(async (_req: Request): Promise<Response> => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { hh, mm, dateStr, dayKey } = getNigeriaTime()
  const currentTime = `${hh}:${mm}`
  const weekKey = getSaturdayAnchor(dateStr)

  console.log(`[alarm-check] ${dateStr} ${currentTime} WAT | day=${dayKey} | week=${weekKey}`)

  try {
    const { data: baseTasks, error: tasksErr } = await supabase
      .from('tasks')
      .select('*')
      .eq('day_key', dayKey)
      .eq('active', true)

    if (tasksErr) throw tasksErr

    const { data: stateRows } = await supabase
      .from('tracker_state')
      .select('id, text_val')
      .in('id', [`blob_custom_tasks_${weekKey}`, 'blob_recurring_tasks'])

    let customTasks: Task[] = []
    let recurringTasks: Task[] = []

    if (Array.isArray(stateRows)) {
      stateRows.forEach((row: any) => {
        if (!row.text_val) return
        try {
          const parsed = JSON.parse(row.text_val)
          if (!Array.isArray(parsed)) return
          if (row.id === `blob_custom_tasks_${weekKey}`) customTasks = parsed
          if (row.id === 'blob_recurring_tasks') recurringTasks = parsed
        } catch {}
      })
    }

    const todayCustom = [...customTasks, ...recurringTasks].filter(t => {
      const dk = t.dayKey || t.day_key
      return dk === dayKey
    })

    const allTasks: Task[] = [...(baseTasks || []), ...todayCustom]

    if (allTasks.length === 0) {
      console.log(`[alarm-check] No tasks for ${dayKey}`)
      return new Response(
        JSON.stringify({ status: 'ok', time: currentTime, day: dayKey, alerts_fired: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[alarm-check] ${allTasks.length} tasks loaded for ${dayKey} (${(baseTasks || []).length} base + ${todayCustom.length} custom)`)

    if (await dayIsSkipped(supabase, dayKey, weekKey)) {
      console.log(`[alarm-check] Day skipped: ${dayKey}`)
      return new Response(
        JSON.stringify({ status: 'ok', time: currentTime, day: dayKey, alerts_fired: 0, note: 'day skipped' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    let alertsFired = 0

    for (const task of allTasks) {
      const taskId = task.id
      const timeStr = taskTime(task)
      const text = taskText(task)
      const brand = taskBrand(task)
      const isCounter = task.is_counter === true || task.isCounter === true

      if (!taskId || isCounter || !timeStr) continue

      const parsedTime = parseTimeString(timeStr)
      if (!parsedTime) continue

      const priority = getTaskAlertPriority(task)
      const offsets = getAlertOffsets(priority)
      if (!offsets.length) continue

      if (await alreadyDone(supabase, taskId, weekKey)) {
        console.log(`[alarm-check] Already done: ${taskId}`)
        continue
      }

      for (const offsetMins of offsets) {
        const targetTime = subtractMinutes(parsedTime, offsetMins)
        if (targetTime !== currentTime) continue

        const alertId = `${taskId}_${dateStr}_${priority}_${offsetMins}_${parsedTime}`
        if (await alertAlreadyFired(supabase, alertId)) {
          console.log(`[alarm-check] Already fired: ${alertId}`)
          continue
        }

        const title = getAlertTitle(priority, brand, offsetMins)
        const message = `[${timeStr}] ${formatLead(offsetMins)}: ${text}`
        const tags = getAlertTags(priority, brand)
        const ntfyPriority = getNtfyPriority(priority)

        console.log(`[alarm-check] FIRING (${priority} T-${offsetMins}): ${title} -- ${message}`)
        const ntfyResult = await fireNotification(title, message, ntfyPriority, tags)
        console.log(`[alarm-check] ntfy response: ${ntfyResult.status} ${ntfyResult.body}`)

        if (!ntfyResult.ok) {
          console.log(`[alarm-check] ntfy rejected alert, not marking fired: ${alertId}`)
          continue
        }

        await supabase.from('alerts_fired').upsert({
          id:         alertId,
          task_id:    taskId,
          fired_date: dateStr
        })

        alertsFired++
      }
    }

    return new Response(
      JSON.stringify({ status: 'ok', time: currentTime, day: dayKey, alerts_fired: alertsFired }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[alarm-check] Error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
