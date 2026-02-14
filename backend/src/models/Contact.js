import mongoose from 'mongoose'

const contactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: [/\S+@\S+\.\S+/, 'Invalid email format']
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  message: {
    type: String,
    required: true,
    trim: true,
    minlength: 10,
    maxlength: 5000
  },
  status: {
    type: String,
    enum: ['new', 'read', 'replied', 'resolved'],
    default: 'new'
  },
  response: {
    type: String,
    default: null
  },
  responseDate: {
    type: Date,
    default: null
  },
  respondedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true })

// Index for faster queries
contactSchema.index({ email: 1, createdAt: -1 })
contactSchema.index({ status: 1, createdAt: -1 })

export default mongoose.model('Contact', contactSchema)
