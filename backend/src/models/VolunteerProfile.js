import mongoose from 'mongoose'

const volunteerProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  tier: {
    type: String,
    enum: ['basic', 'verified', 'team_lead'],
    default: 'basic'
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'inactive'],
    default: 'active'
  },
  joinDate: {
    type: Date,
    default: Date.now
  },
  hoursLogged: {
    type: Number,
    default: 0
  },
  eventsAttended: {
    type: Number,
    default: 0
  },
  skills: [{
    type: String,
    trim: true
  }],
  availability: {
    weekdays: [String],
    preferredTimes: [String],
    notes: String
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  badges: [{
    name: String,
    earnedDate: Date,
    description: String
  }],
  adminNotes: {
    type: String,
    default: ''
  },
  location: {
    city: String,
    state: String,
    zipCode: String
  }
}, {
  timestamps: true
})

const VolunteerProfile = mongoose.model('VolunteerProfile', volunteerProfileSchema)
export default VolunteerProfile
