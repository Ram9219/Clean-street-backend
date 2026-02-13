
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: function() {
      // Password not required if user is OAuth authenticated
      return !this.googleId
    }
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['citizen', 'volunteer', 'admin', 'super-admin'],
    default: 'citizen'
  },
  
  // Volunteer specific fields
  volunteer_tier: {
    type: String,
    enum: {
      values: ['basic', 'verified', 'team_lead'],
      message: '{VALUE} is not a valid volunteer tier'
    },
    default: undefined
  },
  volunteer_status: {
    type: String,
    enum: {
      values: ['pending', 'active', 'inactive'],
      message: '{VALUE} is not a valid volunteer status'
    },
    default: undefined
  },
  
  // Super admin specific fields
  isSuperAdmin: {
    type: Boolean,
    default: false
  },
  permissions: [{
    type: String,
    enum: ['all', 'manage_users', 'manage_reports', 'manage_settings', 'manage_admins', 'view_analytics', 'manage_content']
  }],
  mustChangePassword: {
    type: Boolean,
    default: false
  },
  
  // Email verification
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationOTP: {
    type: String
  },
  emailVerificationExpiry: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  phone: {
    type: String,
    default: ''
  },
  profilePicture: {
    type: String,
    default: ''
  },
  lastLogin: {
    type: Date
  },
  
  // 2FA settings
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorSecret: {
    type: String
  },
  
  // Account security
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },
  
  // Password reset
  resetPasswordOTP: {
    type: String
  },
  resetPasswordExpiry: {
    type: Date
  },
  
  // Google OAuth
  googleId: {
    type: String
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
})

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next()
  
  try {
    const salt = await bcrypt.genSalt(10)
    this.password = await bcrypt.hash(this.password, salt)
    next()
  } catch (error) {
    next(error)
  }
})

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password)
}

// Check if user has permission
userSchema.methods.hasPermission = function(permission) {
  if (this.isSuperAdmin || this.permissions.includes('all')) {
    return true
  }
  return this.permissions.includes(permission)
}

// Check if user can manage other admins
userSchema.methods.canManageAdmins = function() {
  return this.isSuperAdmin || this.hasPermission('manage_admins')
}

const User = mongoose.model('User', userSchema)
export default User