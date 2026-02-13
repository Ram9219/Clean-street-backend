import mongoose from 'mongoose'

const volunteerApplicationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  applyingFor: {
    type: String,
    enum: ['verified', 'team_lead'],
    required: true
  },
  experience: {
    type: String,
    required: true
  },
  motivation: {
    type: String,
    required: true
  },
  references: [{
    name: String,
    contact: String,
    relationship: String
  }],
  documents: [{
    url: String,
    fileName: String,
    uploadedAt: Date
  }],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'more_info_needed'],
    default: 'pending'
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewNotes: {
    type: String
  },
  reviewedAt: {
    type: Date
  }
}, {
  timestamps: true
})

const VolunteerApplication = mongoose.model('VolunteerApplication', volunteerApplicationSchema)
export default VolunteerApplication
