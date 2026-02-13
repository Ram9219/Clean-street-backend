import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  link: {
    type: String,
    trim: true,
    default: ''
  },
  type: {
    type: String,
    default: 'info'
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: { createdAt: true, updatedAt: false }
})

notificationSchema.index({ userId: 1, createdAt: -1 })

export default mongoose.model('Notification', notificationSchema)
