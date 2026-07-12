// ============================================================
// ENIGMA OUTPUT TRACKER - TELEGRAM ALARM ACTIONS
// File path: supabase/functions/telegram-alarm-actions/index.ts
//
// Receives Telegram inline button clicks.
// Currently supports:
// - Snooze 10m
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''

function getNigeriaNow() {
  const now = new Date()
  const wat = new Date(now.getTime() + 60 * 60 * 1000)
  return {
    dateStr: `${wat.getUTCFullYear()}-${String(wat.getUTCMonth()+1).padStart(2,'0')}-${String(wat.getUTCDate()).padStart(2,'0')}`,
    timeStr: `${String(wat.getUTCHours()).padStart(2,'0')}:${String(wat.getUTCMinutes()).padStart(2,'0')}`
  }
}

function addMinutes(dateStr: string, timeStr: string, minutes: number): { dateStr: string; timeStr: string } {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(`${dateStr}T00:00:00Z`)
  let total = h * 60 + m + minutes
  while (total >= 1440) {
    total -= 1440
    d.setUTCDate(d.getUTCDate() + 1)
  }
  while (total < 0) {
    total += 1440
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return {
    dateStr: `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`,
    timeStr: `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`
  }
}

async function answerCallback(callbackQueryId: string, text: string) {
  if (!TELEGRAM_BOT_TOKEN) return
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
      show_alert: false
    })
  }).catch(() => {})
}

async function editTelegramMessage(chatId: number | string, messageId: number, text: string) {
  if (!TELEGRAM_BOT_TOKEN) return
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] }
    })
  }).catch(() => {})

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    })
  }).catch(() => {})
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: true, note: 'telegram alarm action endpoint' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const update = await req.json()
    const callback = update.callback_query
    const data = String(callback?.data || '')
    const callbackId = String(callback?.id || '')

    if (!callback || !data.startsWith('s10:')) {
      if (callbackId) await answerCallback(callbackId, 'Unknown action')
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const actionId = data.slice(4)
    const { data: actionRow, error } = await supabase
      .from('tracker_state')
      .select('id, text_val, week_key')
      .eq('id', `tg_action_${actionId}`)
      .maybeSingle()

    if (error) throw error

    if (!actionRow?.text_val) {
      await answerCallback(callbackId, 'This alarm action expired.')
      return new Response(JSON.stringify({ ok: true, missing_action: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const payload = JSON.parse(actionRow.text_val)
    const now = getNigeriaNow()
    const due = addMinutes(now.dateStr, now.timeStr, 10)
    const snoozeId = `snooze_${actionId}_${Date.now()}`

    await supabase.from('tracker_state').upsert({
      id: snoozeId,
      is_done: false,
      counter_val: null,
      text_val: JSON.stringify({
        taskId: payload.taskId,
        title: payload.title,
        message: payload.message,
        dueDate: due.dateStr,
        dueTime: due.timeStr,
        createdAt: new Date().toISOString()
      }),
      week_key: payload.weekKey || actionRow.week_key,
      updated_at: new Date().toISOString()
    })

    await supabase.from('tracker_state').upsert({
      id: actionRow.id,
      is_done: true,
      counter_val: null,
      text_val: actionRow.text_val,
      week_key: actionRow.week_key,
      updated_at: new Date().toISOString()
    })

    await answerCallback(callbackId, `Snoozed until ${due.timeStr}`)

    const chatId = callback.message?.chat?.id
    const messageId = callback.message?.message_id
    if (chatId && messageId) {
      await editTelegramMessage(chatId, messageId, `Snoozed 10m. It will come back at ${due.timeStr}.`)
    }

    return new Response(JSON.stringify({ ok: true, snoozed_until: due }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('[telegram-alarm-actions] Error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
