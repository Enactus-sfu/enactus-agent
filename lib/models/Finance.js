import mongoose from 'mongoose'

const FinanceSchema = new mongoose.Schema(
  {
    submissionId: { type: String, required: true, unique: true },
    type: { type: String, enum: ['reimbursement', 'request'], required: true },
    item: { type: String, required: true },
    date: { type: String, required: true },
    amount: { type: String, required: true },
    etransferName: { type: String, required: true },
    etransferEmail: { type: String, required: true },
    // Project or portfolio (lib/teams.js). Older records have `event` instead.
    team: { type: String },
    event: { type: String },
    receiptUrl: { type: String },
  },
  { timestamps: true }
)

export default mongoose.models.Finance || mongoose.model('Finance', FinanceSchema)
