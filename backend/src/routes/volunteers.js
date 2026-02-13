import express from 'express'
import User from '../models/User.js'
import VolunteerProfile from '../models/VolunteerProfile.js'
import VolunteerApplication from '../models/VolunteerApplication.js'
import Notification from '../models/Notification.js'
import Event from '../models/Event.js'
import { body, validationResult } from 'express-validator'
import { authLimiter, otpRequestLimiter } from '../middleware/rateLimiter.js'
import passport from '../config/passport.js'
import emailService from '../config/email.js'

const router = express.Router()

// ========== MIDDLEWARE ==========

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next()
  }
  res.status(401).json({ success: false, error: 'Not authenticated' })
}

const isVolunteer = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'volunteer') {
    return next()
  }
  res.status(403).json({ success: false, error: 'Volunteer access required' })
}

const canCreateEvents = (req, res, next) => {
  if (req.isAuthenticated() && 
      req.user.role === 'volunteer' && 
      req.user.volunteer_status === 'active') {
    return next()
  }
  res.status(403).json({ success: false, error: 'Active volunteer access required' })
}

// ========== VOLUNTEER REGISTRATION ==========

// Volunteer Login (frontend compatibility)
router.post('/login', authLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err)
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: info?.message || 'Invalid credentials'
      })
    }

    if (user.role !== 'volunteer') {
      return res.status(403).json({
        success: false,
        error: 'Volunteer access required'
      })
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        error: 'Please verify your email first. Check your inbox for the OTP.',
        requiresEmailVerification: true
      })
    }

    req.login(user, (loginError) => {
      if (loginError) {
        return next(loginError)
      }

      res.json({
        success: true,
        message: 'Login successful',
        user: {
          _id: user._id,
          id: user._id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          profilePicture: user.profilePicture,
          isEmailVerified: user.isEmailVerified,
          volunteer_tier: user.volunteer_tier,
          volunteer_status: user.volunteer_status
        }
      })
    })
  })(req, res, next)
})

// Register as basic volunteer (auto-approved)
router.post('/register-basic', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').trim().notEmpty(),
  body('phone').optional().trim().matches(/^[0-9]{10}$|^[\+]?[0-9\-\s\(\)]{10,}$/, 'i'),
  body('location.city').optional().trim(),
  body('location.state').optional().trim(),
  body('location.zipCode').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map(err => err.msg || err.param).join(', ')
      return res.status(400).json({ 
        success: false, 
        error: `Validation error: ${errorMessages}`,
        errors: errors.array() 
      })
    }

    const { email, password, name, phone, location } = req.body

    // Check if user exists
    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Email already registered' })
    }

    // Create user as volunteer
    const user = new User({
      email,
      password,
      name,
      phone: phone || '',
      role: 'volunteer',
      volunteer_status: 'pending',
      isEmailVerified: false
    })

    await user.save()

    // Create volunteer profile
    const volunteerProfile = new VolunteerProfile({
      userId: user._id,
      status: 'pending',
      location: location || {}
    })

    await volunteerProfile.save()

    try {
      const admins = await User.find({
        role: { $in: ['admin', 'super-admin'] },
        isActive: true
      }).select('_id').lean()

      if (admins.length > 0) {
        const notifications = admins.map(admin => ({
          userId: admin._id,
          title: 'Volunteer verification pending',
          message: `${user.name} registered as a volunteer`,
          link: '/pending-volunteers',
          type: 'admin'
        }))
        await Notification.insertMany(notifications)
      }
    } catch (notifyError) {
      console.error('Notification error:', notifyError)
    }

    // Generate and send OTP
    const otp = emailService.generateOTP(6)
    user.emailVerificationOTP = otp
    user.emailVerificationExpiry = Date.now() + 10 * 60 * 1000 // 10 minutes
    await user.save()

    // Send OTP email
    await emailService.sendEmail(
      email,
      'Welcome to Clean Street Volunteers - Verify Email',
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to Clean Street Volunteers!</h2>
        <p>Thank you for joining as a volunteer. Please verify your email with this OTP:</p>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px;">
          <h1 style="margin: 0; color: #1976d2; letter-spacing: 5px; font-size: 2em;">${otp}</h1>
        </div>
        <p style="color: #666;">This OTP is valid for 10 minutes.</p>
        <p>You're now registered as a <strong>Volunteer</strong>! Once verified by our admin team, you can start joining community events!</p>
      </div>
      `
    )

    res.status(201).json({
      success: true,
      message: 'Basic volunteer registration successful. Check your email for OTP verification.',
      email: user.email
    })
  } catch (error) {
    console.error('Volunteer registration error:', error)
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Registration failed',
      details: process.env.NODE_ENV === 'development' ? error.toString() : undefined
    })
  }
})

// Verify volunteer email with OTP
router.post('/verify-email', otpRequestLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email or OTP format'
      })
    }

    const { email, otp } = req.body

    const user = await User.findOne({ email, role: 'volunteer' })

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        error: 'Email already verified'
      })
    }

    if (!user.emailVerificationExpiry || user.emailVerificationExpiry < Date.now()) {
      return res.status(400).json({
        success: false,
        error: 'OTP has expired. Please request a new OTP.'
      })
    }

    if (user.emailVerificationOTP !== otp) {
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP. Please try again.'
      })
    }

    user.isEmailVerified = true
    user.emailVerificationOTP = undefined
    user.emailVerificationExpiry = undefined
    await user.save()

    res.json({
      success: true,
      message: 'Email verified successfully. You can now login.'
    })
  } catch (error) {
    console.error('Volunteer email verification error:', error)
    res.status(500).json({
      success: false,
      error: 'Verification failed'
    })
  }
})

// ========== PASSWORD RESET WITH OTP ==========

// Request password reset OTP
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Valid email is required' })
    }

    const { email } = req.body

    const user = await User.findOne({ email, role: 'volunteer' })
    if (!user) {
      // Don't reveal if user exists or not for security
      return res.json({
        success: true,
        message: 'If an account exists with this email, you will receive an OTP.'
      })
    }

    // Generate OTP
    const otp = emailService.generateOTP(6)
    user.emailVerificationOTP = otp
    user.emailVerificationExpiry = Date.now() + 10 * 60 * 1000 // 10 minutes
    await user.save()

    // Send OTP email
    await emailService.sendEmail(
      email,
      'Password Reset OTP - Clean Street Volunteers',
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Password Reset Request</h2>
        <p>You requested to reset your password. Use this OTP to proceed:</p>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px;">
          <h1 style="margin: 0; color: #1976d2; letter-spacing: 5px; font-size: 2em;">${otp}</h1>
        </div>
        <p style="color: #666;">This OTP is valid for 10 minutes.</p>
        <p style="color: #999; font-size: 0.9em;">If you didn't request this, please ignore this email.</p>
      </div>
      `
    )

    res.json({
      success: true,
      message: 'OTP sent to your email'
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    res.status(500).json({ success: false, error: 'Failed to send OTP' })
  }
})

// Verify OTP for password reset
router.post('/verify-reset-otp', [
  body('email').isEmail().normalizeEmail(),
  body('otp').trim().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Valid email and OTP required' })
    }

    const { email, otp } = req.body

    const user = await User.findOne({ email, role: 'volunteer' })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }

    if (!user.emailVerificationOTP || user.emailVerificationOTP !== otp) {
      return res.status(400).json({ success: false, error: 'Invalid OTP' })
    }

    if (Date.now() > user.emailVerificationExpiry) {
      return res.status(400).json({ success: false, error: 'OTP expired. Please request a new one.' })
    }

    res.json({
      success: true,
      message: 'OTP verified successfully'
    })
  } catch (error) {
    console.error('Verify OTP error:', error)
    res.status(500).json({ success: false, error: 'Verification failed' })
  }
})

// Reset password with OTP
router.post('/reset-password', [
  body('email').isEmail().normalizeEmail(),
  body('otp').trim().notEmpty(),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Valid email, OTP, and password (min 6 characters) required' 
      })
    }

    const { email, otp, newPassword } = req.body

    const user = await User.findOne({ email, role: 'volunteer' })
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' })
    }

    if (!user.emailVerificationOTP || user.emailVerificationOTP !== otp) {
      return res.status(400).json({ success: false, error: 'Invalid OTP' })
    }

    if (Date.now() > user.emailVerificationExpiry) {
      return res.status(400).json({ success: false, error: 'OTP expired. Please request a new one.' })
    }

    // Update password
    user.password = newPassword
    user.emailVerificationOTP = undefined
    user.emailVerificationExpiry = undefined
    await user.save()

    // Send confirmation email
    await emailService.sendEmail(
      email,
      'Password Reset Successful - Clean Street Volunteers',
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4CAF50;">Password Reset Successful</h2>
        <p>Your password has been successfully reset.</p>
        <p>You can now login with your new password.</p>
        <p style="color: #999; font-size: 0.9em; margin-top: 30px;">
          If you didn't make this change, please contact support immediately.
        </p>
      </div>
      `
    )

    res.json({
      success: true,
      message: 'Password reset successful'
    })
  } catch (error) {
    console.error('Reset password error:', error)
    res.status(500).json({ success: false, error: 'Failed to reset password' })
  }
})

// Apply for verified volunteer or team lead (requires admin approval)
// ========== VOLUNTEER PROFILE ==========

// Get volunteer profile
router.get('/profile', isVolunteer, async (req, res) => {
  try {
    const profile = await VolunteerProfile.findOne({ userId: req.user._id })

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Profile not found' })
    }

    res.json({
      success: true,
      profile,
      user: {
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        status: req.user.volunteer_status
      }
    })
  } catch (error) {
    console.error('Get profile error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch profile' })
  }
})

// Update volunteer profile
router.put('/profile', isVolunteer, async (req, res) => {
  try {
    const { skills, availability, location } = req.body

    const profile = await VolunteerProfile.findOne({ userId: req.user._id })

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Profile not found' })
    }

    if (skills) profile.skills = skills
    if (availability) profile.availability = availability
    if (location) profile.location = location

    await profile.save()

    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile
    })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ success: false, error: 'Failed to update profile' })
  }
})

// ========== EVENTS ==========

// Get upcoming events
router.get('/events/upcoming', isVolunteer, async (req, res) => {
  try {
    const now = new Date()

    const events = await Event.find({
      'dateTime.start': { $gte: now },
      status: 'upcoming'
    })
      .populate('createdBy', 'name email')
      .populate('teamLead', 'name email')
      .sort({ 'dateTime.start': 1 })
      .lean()

    res.json({
      success: true,
      events
    })
  } catch (error) {
    console.error('Get events error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch events' })
  }
})

// Register for event
router.post('/events/:id/register', isVolunteer, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' })
    }

    // Check if already registered
    const alreadyRegistered = event.volunteersRegistered.some(
      v => v.volunteer.toString() === req.user._id.toString()
    )

    if (alreadyRegistered) {
      return res.status(400).json({ success: false, error: 'Already registered for this event' })
    }

    // Check if event is full
    if (event.volunteersRegistered.length >= event.maxVolunteers) {
      return res.status(400).json({ success: false, error: 'Event is full' })
    }

    // Check tier eligibility
    const tierHierarchy = { 'basic': 0, 'verified': 1, 'team_lead': 2 }
    const userTier = tierHierarchy[req.user.volunteer_tier] || 0
    const eventTier = tierHierarchy[event.requiredTier] || 0

    if (userTier < eventTier) {
      return res.status(403).json({ success: false, error: 'Insufficient volunteer tier for this event' })
    }

    event.volunteersRegistered.push({
      volunteer: req.user._id,
      status: 'registered'
    })

    await event.save()

    res.json({
      success: true,
      message: 'Successfully registered for event',
      event
    })
  } catch (error) {
    console.error('Event registration error:', error)
    res.status(500).json({ success: false, error: 'Registration failed' })
  }
})

// Check in to event
router.post('/events/:id/checkin', isVolunteer, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' })
    }

    const registration = event.volunteersRegistered.find(
      v => v.volunteer.toString() === req.user._id.toString()
    )

    if (!registration) {
      return res.status(400).json({ success: false, error: 'Not registered for this event' })
    }

    if (registration.status === 'checked_in') {
      return res.status(400).json({ success: false, error: 'Already checked in' })
    }

    registration.status = 'checked_in'
    registration.checkinTime = new Date()

    await event.save()

    res.json({
      success: true,
      message: 'Checked in successfully'
    })
  } catch (error) {
    console.error('Check-in error:', error)
    res.status(500).json({ success: false, error: 'Check-in failed' })
  }
})

// Check out from event
router.post('/events/:id/checkout', isVolunteer, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' })
    }

    const registration = event.volunteersRegistered.find(
      v => v.volunteer.toString() === req.user._id.toString()
    )

    if (!registration) {
      return res.status(400).json({ success: false, error: 'Not registered for this event' })
    }

    if (registration.status !== 'checked_in') {
      return res.status(400).json({ success: false, error: 'Must check in first' })
    }

    registration.status = 'checked_out'
    registration.checkoutTime = new Date()

    // Calculate hours
    if (registration.checkinTime) {
      const hours = (registration.checkoutTime - registration.checkinTime) / (1000 * 60 * 60)
      registration.hoursCredited = Math.round(hours * 10) / 10 // Round to 1 decimal
    }

    await event.save()

    // Update volunteer profile hours
    const profile = await VolunteerProfile.findOne({ userId: req.user._id })
    if (profile) {
      profile.hoursLogged += registration.hoursCredited
      profile.eventsAttended += 1
      await profile.save()
    }

    res.json({
      success: true,
      message: 'Checked out successfully',
      hoursCredited: registration.hoursCredited
    })
  } catch (error) {
    console.error('Check-out error:', error)
    res.status(500).json({ success: false, error: 'Check-out failed' })
  }
})

// Get my registered events
router.get('/my-events', isVolunteer, async (req, res) => {
  try {
    const events = await Event.find({
      'volunteersRegistered.volunteer': req.user._id
    })
      .populate('createdBy', 'name email')
      .populate('teamLead', 'name email')
      .sort({ 'dateTime.start': -1 })

    res.json({
      success: true,
      events
    })
  } catch (error) {
    console.error('Get my events error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch events' })
  }
})

// ========== EVENT MANAGEMENT (VERIFIED+) ==========

// Create event
router.post('/events', canCreateEvents, [
  body('title').trim().notEmpty(),
  body('description').trim().notEmpty(),
  body('dateTime.start').isISO8601(),
  body('dateTime.end').isISO8601(),
  body('maxVolunteers').optional().isInt({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() })
    }

    const { title, description, location, dateTime, maxVolunteers, equipmentNeeded, instructions, status } = req.body

    const event = new Event({
      title,
      description,
      location,
      dateTime,
      maxVolunteers: maxVolunteers || 50,
      status: status || 'upcoming',
      createdBy: req.user._id,
      teamLead: req.user._id,
      equipmentNeeded,
      instructions
    })

    await event.save()

    res.status(201).json({
      success: true,
      message: 'Event created successfully',
      event
    })
  } catch (error) {
    console.error('Create event error:', error)
    console.error('Error details:', error.message)
    if (error.errors) {
      console.error('Validation errors:', error.errors)
    }
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create event',
      message: error.message,
      details: error.errors
    })
  }
})

// Update event
router.put('/events/:id', canCreateEvents, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' })
    }

    // Check if user created the event or is team lead
    if (event.createdBy.toString() !== req.user._id.toString() && 
        req.user.volunteer_tier !== 'team_lead') {
      return res.status(403).json({ success: false, error: 'Not authorized to edit this event' })
    }

    const { title, description, location, dateTime, maxVolunteers, equipmentNeeded, instructions } = req.body

    if (title) event.title = title
    if (description) event.description = description
    if (location) event.location = location
    if (dateTime) event.dateTime = dateTime
    if (maxVolunteers) event.maxVolunteers = maxVolunteers
    if (equipmentNeeded) event.equipmentNeeded = equipmentNeeded
    if (instructions) event.instructions = instructions

    await event.save()

    res.json({
      success: true,
      message: 'Event updated successfully',
      event
    })
  } catch (error) {
    console.error('Update event error:', error)
    res.status(500).json({ success: false, error: 'Failed to update event' })
  }
})

// Delete event
router.delete('/events/:id', canCreateEvents, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' })
    }

    // Check if user created the event or is team lead
    if (event.createdBy.toString() !== req.user._id.toString() && 
        req.user.volunteer_tier !== 'team_lead') {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this event' })
    }

    await Event.deleteOne({ _id: req.params.id })

    res.json({
      success: true,
      message: 'Event deleted successfully'
    })
  } catch (error) {
    console.error('Delete event error:', error)
    res.status(500).json({ success: false, error: 'Failed to delete event' })
  }
})

// Get event participants
router.get('/events/:id/participants', canCreateEvents, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('volunteersRegistered.volunteer', 'name email phone')

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' })
    }

    res.json({
      success: true,
      participants: event.volunteersRegistered
    })
  } catch (error) {
    console.error('Get participants error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch participants' })
  }
})

export default router
