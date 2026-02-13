import mongoose from 'mongoose'

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  location: {
    address: String,
    city: String,
    state: String,
    zipCode: String,
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    }
  },
  dateTime: {
    start: {
      type: Date,
      required: true
    },
    end: {
      type: Date,
      required: true
    }
  },
  requiredTier: {
    type: String,
    enum: ['basic', 'verified', 'team_lead'],
    default: 'basic'
  },
  maxVolunteers: {
    type: Number,
    default: 10
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  teamLead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  volunteersRegistered: [{
    volunteer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['registered', 'checked_in', 'checked_out', 'cancelled', 'no_show'],
      default: 'registered'
    },
    hoursCredited: {
      type: Number,
      default: 0
    },
    checkinTime: Date,
    checkoutTime: Date
  }],
  status: {
    type: String,
    enum: ['upcoming', 'ongoing', 'completed', 'cancelled'],
    default: 'upcoming'
  },
  equipmentNeeded: [String],
  instructions: String
}, {
  timestamps: true
})

const Event = mongoose.model('Event', eventSchema)
export default Event
