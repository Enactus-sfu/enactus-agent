import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import { uploadReceiptToDrive } from '@/lib/drive'
import Finance from '@/lib/models/Finance'
import { appendFinanceRow } from '@/lib/sheets'
import { postFinanceToSlack } from '@/lib/slack'
import { TEAMS } from '@/lib/teams'

const encoder = new TextEncoder()

function emit(controller, data) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
}

export async function POST(req) {
  const formData = await req.formData()

  const submissionId = formData.get('submissionId')
  const type = formData.get('type')
  const item = formData.get('item')
  const date = formData.get('date')
  const amount = formData.get('amount')
  const etransferName = formData.get('etransferName')
  const etransferEmail = formData.get('etransferEmail')
  const team = formData.get('team')
  const receipt = formData.get('receipt')
  const hasReceipt = receipt instanceof File && receipt.size > 0

  if (!submissionId || !type || !item || !date || !amount || !etransferName || !etransferEmail || !team) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
  }

  if (!TEAMS.includes(team)) {
    return NextResponse.json({ error: 'Unknown project or portfolio.' }, { status: 400 })
  }

  if (type === 'reimbursement' && !hasReceipt) {
    return NextResponse.json({ error: 'Receipt is required for reimbursements.' }, { status: 400 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        emit(controller, { step: 0 })
        const receiptUrl = hasReceipt
          ? await uploadReceiptToDrive(receipt, { item, etransferName, team })
          : ''

        emit(controller, { step: 1 })
        const data = { submissionId, type, item, date, amount, etransferName, etransferEmail, team, receiptUrl }
        await connectDB()
        try {
          await Finance.create(data)
        } catch (err) {
          if (err.code === 11000) {
            emit(controller, { error: 'Duplicate submission detected.' })
            return
          }
          throw err
        }

        emit(controller, { step: 2 })
        await appendFinanceRow(data)

        emit(controller, { step: 3 })
        await postFinanceToSlack(data)

        emit(controller, { done: true, summary: { type, item, amount, team, etransferName, hasReceipt } })
      } catch (err) {
        console.error('[finance/submit] Error:', err?.message ?? err)

        if (!process.env.GOOGLE_CLIENT_EMAIL) console.warn('[finance/submit] Missing env: GOOGLE_CLIENT_EMAIL')
        if (!process.env.GOOGLE_PRIVATE_KEY) console.warn('[finance/submit] Missing env: GOOGLE_PRIVATE_KEY')
        if (!process.env.GOOGLE_DRIVE_FOLDER_ID) console.warn('[finance/submit] Missing env: GOOGLE_DRIVE_FOLDER_ID')
        if (!process.env.MONGODB_URI) console.warn('[finance/submit] Missing env: MONGODB_URI')
        if (!process.env.SLACK_BOT_TOKEN) console.warn('[finance/submit] Missing env: SLACK_BOT_TOKEN')

        emit(controller, { error: err?.message ?? 'Something went wrong.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
