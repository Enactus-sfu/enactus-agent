'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { PROJECTS, PORTFOLIOS, TEAMS } from '@/lib/teams'

const TYPES = [
  { id: 'reimbursement', label: 'Reimbursement' },
  { id: 'request', label: 'Money Request' },
]

const STEPS = [
  { id: 'receipt', label: 'Uploading receipt' },
  { id: 'db', label: 'Saving to database' },
  { id: 'sheets', label: 'Logging to spreadsheet' },
  { id: 'slack', label: 'Notifying Slack' },
]

const DRAFT_KEY = 'finance-draft'
const SAVED_INFO_KEY = 'finance-saved-info'

const inputBase = 'w-full rounded-md border px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition bg-white'
const inputClass = `${inputBase} border-zinc-200 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100`
const inputErrorClass = `${inputBase} border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-50`

function fieldCls(hasError) {
  return hasError ? inputErrorClass : inputClass
}

function StepList({ steps, currentStep, failedStep }) {
  return (
    <div className="space-y-2 pt-1">
      {steps.map((step, i) => {
        const done = currentStep > i
        const active = currentStep === i
        const failed = failedStep === i
        return (
          <div key={step.id} className="flex items-center gap-2.5">
            <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
              done ? 'bg-zinc-900' : active && failed ? 'bg-red-400' : active ? 'bg-zinc-300' : 'bg-zinc-100'
            }`}>
              {done && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {active && failed && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {active && !failed && <div className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-pulse" />}
            </div>
            <span className={`text-xs transition-colors ${
              done ? 'text-zinc-400 line-through' : active && failed ? 'text-red-500 font-medium' : active ? 'text-zinc-700 font-medium' : 'text-zinc-300'
            }`}>
              {step.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function FinancePage() {
  const [type, setType] = useState('reimbursement')
  const [form, setForm] = useState({
    item: '',
    date: '',
    amount: '',
    etransferName: '',
    etransferEmail: '',
  })
  const [team, setTeam] = useState('')
  const submissionId = useRef(crypto.randomUUID())
  const [receipt, setReceipt] = useState(null)
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [currentStep, setCurrentStep] = useState(-1)
  const [failedStep, setFailedStep] = useState(-1)
  const [successSummary, setSuccessSummary] = useState(null)
  const [saveInfo, setSaveInfo] = useState(false)

  // Load saved info then draft on mount
  useEffect(() => {
    try {
      const si = localStorage.getItem(SAVED_INFO_KEY)
      if (si) {
        const info = JSON.parse(si)
        setSaveInfo(true)
        setForm((prev) => ({
          ...prev,
          etransferName: info.etransferName ?? prev.etransferName,
          etransferEmail: info.etransferEmail ?? prev.etransferEmail,
        }))
      }
    } catch {}

    try {
      const d = localStorage.getItem(DRAFT_KEY)
      if (!d) return
      const { type: t, team: tm, form: f } = JSON.parse(d)
      if (t) setType(t)
      if (TEAMS.includes(tm)) setTeam(tm)
      if (f) setForm((prev) => ({
        ...prev,
        item: f.item ?? prev.item,
        date: f.date ?? prev.date,
        amount: f.amount ?? prev.amount,
      }))
    } catch {}
  }, [])

  // Save draft (excludes e-transfer fields — handled by saveInfo)
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        type,
        team,
        form: { item: form.item, date: form.date, amount: form.amount },
      }))
    } catch {}
  }, [type, team, form.item, form.date, form.amount])

  // Save e-transfer info when checkbox is on
  useEffect(() => {
    try {
      if (saveInfo) {
        localStorage.setItem(SAVED_INFO_KEY, JSON.stringify({
          etransferName: form.etransferName,
          etransferEmail: form.etransferEmail,
        }))
      } else {
        localStorage.removeItem(SAVED_INFO_KEY)
      }
    } catch {}
  }, [saveInfo, form.etransferName, form.etransferEmail])

  function clearError(field) {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: '' }))
  }

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
    clearError(e.target.name)
  }

  function handleAmountChange(e) {
    const val = e.target.value
    // Allow digits and at most one decimal point with up to 2 decimal places
    if (/^(\d*\.?\d{0,2})?$/.test(val)) {
      setForm((prev) => ({ ...prev, amount: val }))
    }
  }

  function handleAmountBlur() {
    const num = parseFloat(form.amount)
    setForm((prev) => ({ ...prev, amount: isNaN(num) ? '' : num.toFixed(2) }))
  }

  function handleTypeChange(id) {
    setType(id)
    setStatus('idle')
    setErrorMsg('')
    setFieldErrors({})
  }

  const steps = STEPS.map((s, i) =>
    i === 0 ? { ...s, label: type === 'reimbursement' ? 'Uploading receipt' : 'Preparing' } : s
  )

  async function handleSubmit(e) {
    e.preventDefault()

    const errors = {}
    if (!team) errors.team = 'Please choose a project or portfolio.'
    if (type === 'reimbursement' && !receipt) errors.receipt = 'Receipt is required for reimbursements.'
    if (!form.amount || isNaN(parseFloat(form.amount))) errors.amount = 'Please enter a valid amount.'
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setStatus('error')
      setErrorMsg('')
      return
    }

    setStatus('loading')
    setCurrentStep(-1)
    setFailedStep(-1)
    setErrorMsg('')
    setFieldErrors({})

    const formData = new FormData()
    formData.append('submissionId', submissionId.current)
    formData.append('type', type)
    formData.append('item', form.item)
    formData.append('date', form.date)
    formData.append('amount', form.amount)
    formData.append('etransferName', form.etransferName)
    formData.append('etransferEmail', form.etransferEmail)
    formData.append('team', team)
    if (receipt) formData.append('receipt', receipt)

    try {
      const res = await fetch('/api/finance/submit', { method: 'POST', body: formData })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Submission failed.')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let activeStep = -1

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          const payload = JSON.parse(part.slice(6))

          if (payload.step !== undefined) {
            activeStep = payload.step
            setCurrentStep(payload.step)
          }

          if (payload.error) {
            setFailedStep(activeStep)
            throw new Error(payload.error)
          }

          if (payload.done) {
            setCurrentStep(STEPS.length)
            setSuccessSummary(payload.summary)
            submissionId.current = crypto.randomUUID()
            localStorage.removeItem(DRAFT_KEY)
            setForm((prev) => ({
              ...prev,
              item: '',
              date: '',
              amount: '',
              // Keep e-transfer fields if saveInfo is on
              etransferName: saveInfo ? prev.etransferName : '',
              etransferEmail: saveInfo ? prev.etransferEmail : '',
            }))
            setTeam('')
            setReceipt(null)
            setStatus('success')
            return
          }
        }
      }
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  if (status === 'success' && successSummary) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
        <div className="max-w-xl w-full space-y-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-zinc-100">
            <svg className="w-6 h-6 text-zinc-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="space-y-2">
            <h2>Request submitted</h2>
            <p>Saved, logged to the spreadsheet, and team notified on Slack.</p>
          </div>
          <div className="rounded-md border border-zinc-100 bg-zinc-50 px-5 py-4 text-left space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Amount</span>
              <span className="font-medium text-zinc-900">${parseFloat(successSummary.amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Item</span>
              <span className="font-medium text-zinc-900 text-right max-w-[60%] truncate">{successSummary.item}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Project/Portfolio</span>
              <span className="font-medium text-zinc-900">{successSummary.team}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">E-transfer to</span>
              <span className="font-medium text-zinc-900">{successSummary.etransferName}</span>
            </div>
            {successSummary.hasReceipt && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Receipt</span>
                <span className="text-zinc-900">Uploaded</span>
              </div>
            )}
          </div>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => { setStatus('idle'); setSuccessSummary(null) }}
              className="text-sm font-medium text-zinc-600 underline underline-offset-4 hover:text-zinc-900"
            >
              Submit another
            </button>
            <Link href="/" className="text-sm font-medium text-zinc-600 underline underline-offset-4 hover:text-zinc-900">
              Go home
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white px-6 py-16">
      <div className="max-w-xl w-full space-y-8">
        <div className="space-y-1">
          <Link href="/" className="text-xs font-medium tracking-widest text-zinc-400 uppercase hover:text-zinc-600 transition-colors">
            ← Enactus
          </Link>
          <h1 className="pt-2">Finance request</h1>
          <p>Submitted requests are logged to the team spreadsheet and posted to Slack.</p>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handleTypeChange(t.id)}
              disabled={status === 'loading'}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all disabled:opacity-50 ${
                type === t.id ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="team" className="block text-sm font-medium text-zinc-700">Project/Portfolio</label>
            <select
              id="team"
              value={team}
              onChange={(e) => { setTeam(e.target.value); clearError('team') }}
              className={fieldCls(fieldErrors.team)}
            >
              <option value="" disabled>Choose a project or portfolio</option>
              <optgroup label="Projects">
                {PROJECTS.map((t) => <option key={t} value={t}>{t}</option>)}
              </optgroup>
              <optgroup label="Portfolios">
                {PORTFOLIOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </optgroup>
            </select>
            {fieldErrors.team && <p className="text-xs text-red-500">{fieldErrors.team}</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="item" className="block text-sm font-medium text-zinc-700">Item / Description</label>
            <input
              id="item"
              name="item"
              type="text"
              required
              value={form.item}
              onChange={handleChange}
              placeholder="e.g. Marketing flyers for pitch event"
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="date" className="block text-sm font-medium text-zinc-700">
                {type === 'reimbursement' ? 'Purchase date' : 'Date needed by'}
              </label>
              <input
                id="date"
                name="date"
                type="date"
                required
                value={form.date}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="amount" className="block text-sm font-medium text-zinc-700">Amount ($)</label>
              <input
                id="amount"
                name="amount"
                type="text"
                inputMode="decimal"
                required
                value={form.amount}
                onChange={handleAmountChange}
                onBlur={handleAmountBlur}
                placeholder="0.00"
                className={fieldCls(fieldErrors.amount)}
              />
              {fieldErrors.amount && <p className="text-xs text-red-500">{fieldErrors.amount}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="etransferName" className="block text-sm font-medium text-zinc-700">E-transfer name</label>
              <input
                id="etransferName"
                name="etransferName"
                type="text"
                required
                value={form.etransferName}
                onChange={handleChange}
                placeholder="Full name"
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="etransferEmail" className="block text-sm font-medium text-zinc-700">E-transfer email</label>
              <input
                id="etransferEmail"
                name="etransferEmail"
                type="email"
                required
                value={form.etransferEmail}
                onChange={handleChange}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="receipt" className="block text-sm font-medium text-zinc-700">
              Receipt / Invoice
              {type === 'reimbursement'
                ? <span className="text-red-500 ml-1">*</span>
                : <span className="text-zinc-400 font-normal ml-1">(optional)</span>
              }
            </label>
            <div className={`relative flex items-center justify-center w-full rounded-md border border-dashed px-4 py-6 text-center hover:border-zinc-400 transition cursor-pointer ${
              fieldErrors.receipt ? 'border-red-400 bg-red-50' : 'border-zinc-300 bg-zinc-50'
            }`}>
              <input
                id="receipt"
                name="receipt"
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => { setReceipt(e.target.files[0] || null); clearError('receipt') }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="space-y-1">
                <p>
                  {receipt ? receipt.name : 'Click or drag receipt here'}
                </p>
                <p className="text-xs text-zinc-400">PNG, JPG, HEIC, PDF accepted</p>
              </div>
            </div>
            {fieldErrors.receipt && <p className="text-xs text-red-500">{fieldErrors.receipt}</p>}
          </div>

          {/* Save info checkbox */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={saveInfo}
              onChange={(e) => setSaveInfo(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-300 accent-zinc-900"
            />
            <span className="text-sm text-zinc-600">Save my name and e-transfer details for next time</span>
          </label>

          {status === 'error' && errorMsg && (
            <p className="text-sm text-red-600">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full rounded-md bg-zinc-950 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'loading' ? 'Submitting…' : 'Submit request'}
          </button>

          {currentStep >= 0 && (
            <StepList steps={steps} currentStep={currentStep} failedStep={failedStep} />
          )}
        </form>
      </div>
    </main>
  )
}
