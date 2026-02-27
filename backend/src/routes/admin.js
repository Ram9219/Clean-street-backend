import express from 'express'
import passport from '../config/passport.js'
import User from '../models/User.js'
import VolunteerProfile from '../models/VolunteerProfile.js'
import VolunteerApplication from '../models/VolunteerApplication.js'
import Event from '../models/Event.js'
import Report from '../models/Report.js'
import { body, validationResult } from 'express-validator'
import { authLimiter, otpRequestLimiter } from '../middleware/rateLimiter.js'
import emailService from '../config/email.js'
import crypto from 'crypto'

const router = express.Router()

const isProd = process.env.NODE_ENV === 'production'
const logDebug = (...args) => {
  if (!isProd) {
    console.log(...args)
  }
}
const logWarn = (...args) => {
  if (!isProd) {
    console.warn(...args)
  }
}

// ========== ADMIN MIDDLEWARE ==========

// Check if user is authenticated AND is admin
const isAdmin = (req, res, next) => {
  logDebug('🔐 isAdmin check:', {
    authenticated: req.isAuthenticated(),
    user: req.user?.email,
    role: req.user?.role,
    sessionID: req.sessionID,
    cookies: Object.keys(req.cookies)
  })
  if (req.isAuthenticated() && ['admin', 'super-admin'].includes(req.user.role)) {
    return next()
  }
  res.status(403).json({ 
    success: false,
    error: 'Admin access required' 
  })
}

// Check if user is super admin
const isSuperAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.isSuperAdmin === true) {
    return next()
  }
  res.status(403).json({ 
    success: false,
    error: 'Super admin access required' 
  })
}

// ========== ADMIN AUTH ROUTES ==========

// 1. Admin Login (with super admin check)
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], authLimiter, (req, res, next) => {
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
    
    // Check if user is admin or super-admin
    if (!['admin', 'super-admin'].includes(user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Admin access required. Please use regular login.',
        userLoginUrl: '/login'
      })
    }
    
    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        error: 'Account is deactivated. Contact super admin.'
      })
    }
    
    req.login(user, async (err) => {
      if (err) {
        return next(err)
      }
      
      // Update last login
      user.lastLogin = new Date()
      await user.save()
      
      // Check if password change is required
      if (user.mustChangePassword) {
        return res.json({
          success: true,
          message: 'Login successful. Password change required.',
          user: {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            isSuperAdmin: user.isSuperAdmin,
            requiresPasswordChange: true
          }
        })
      }
      
      res.json({
        success: true,
        message: 'Admin login successful',
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          isSuperAdmin: user.isSuperAdmin,
          permissions: user.permissions,
          isEmailVerified: user.isEmailVerified,
          twoFactorEnabled: user.twoFactorEnabled,
          requiresPasswordChange: false
        }
      })
    })
  })(req, res, next)
})

// 2. Setup First Super Admin (via web - protected by secret key)
router.post('/setup', async (req, res) => {
  try {
    const { secretKey } = req.body
    
    // Validate secret key
    if (!secretKey || secretKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(403).json({ 
        success: false,
        error: 'Invalid setup key' 
      })
    }
    
    // Check if super admin already exists
    const existingSuperAdmin = await User.findOne({ isSuperAdmin: true })
    if (existingSuperAdmin) {
      return res.status(400).json({ 
        success: false,
        error: 'Super admin already exists. Cannot create another via web.',
        note: 'Use CLI tool for additional super admins'
      })
    }
    
    // Get credentials from environment
    const adminEmail = process.env.ADMIN_EMAIL
    const adminPassword = process.env.ADMIN_PASSWORD
    const adminName = process.env.ADMIN_NAME || 'System Administrator'
    
    if (!adminEmail || !adminPassword) {
      return res.status(500).json({
        success: false,
        error: 'Admin credentials not configured in environment variables'
      })
    }
    
    // Check if email already exists
    const existingUser = await User.findOne({ email: adminEmail })
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered'
      })
    }
    
    // Create super admin
    const admin = new User({
      email: adminEmail.toLowerCase().trim(),
      password: adminPassword,
      name: adminName,
      role: 'super-admin',
      isSuperAdmin: true,
      permissions: ['all'],
      isEmailVerified: true,
      isActive: true,
      mustChangePassword: process.env.FORCE_PASSWORD_CHANGE === 'true'
    })
    
    await admin.save()
    
    // Generate 2FA secret if enabled
    let twoFactorSecret = null
    if (process.env.ENABLE_SUPER_ADMIN_2FA === 'true') {
      twoFactorSecret = crypto.randomBytes(20).toString('hex')
      admin.twoFactorSecret = twoFactorSecret
      await admin.save()
    }
    
    // Send welcome email
    await emailService.sendEmail(
      adminEmail,
      'Super Administrator Account Created',
      `
        <h2>Super Administrator Account Created</h2>
        <p>Your super administrator account has been created successfully.</p>
        <p><strong>Email:</strong> ${adminEmail}</p>
        <p><strong>Name:</strong> ${adminName}</p>
        ${admin.mustChangePassword ? '<p><strong>Note:</strong> You must change your password on first login.</p>' : ''}
        ${twoFactorSecret ? `<p><strong>2FA Secret:</strong> ${twoFactorSecret}</p>` : ''}
        <hr>
        <p><em>Please store these credentials securely.</em></p>
      `
    )
    
    // Clear password from response for security
    const response = {
      success: true,
      message: 'Super admin created successfully',
      admin: {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        mustChangePassword: admin.mustChangePassword
      }
    }
    
    // Only include 2FA secret in response if not sent via email
    if (twoFactorSecret && process.env.ENABLE_SUPER_ADMIN_2FA === 'true') {
      response.twoFactorSecret = twoFactorSecret
      response.note = 'Save this 2FA secret securely!'
    }
    
    res.status(201).json(response)
    
  } catch (error) {
    console.error('Admin setup error:', error)
    res.status(500).json({ 
      success: false,
      error: 'Admin setup failed' 
    })
  }
})

// 3. Force Password Change (for first login)
router.post('/force-password-change', isAdmin, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      })
    }
    
    const { currentPassword, newPassword } = req.body
    const user = await User.findById(req.user._id).select('+password')
    
    // Verify current password
    const isValid = await user.comparePassword(currentPassword)
    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect'
      })
    }
    
    // Update password
    user.password = newPassword
    user.mustChangePassword = false
    await user.save()
    
    res.json({
      success: true,
      message: 'Password changed successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        requiresPasswordChange: false
      }
    })
    
  } catch (error) {
    console.error('Password change error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    })
  }
})

// 4. Create Regular Admin (by admin or super admin)
router.post('/create-admin', isAdmin, [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty(),
  body('permissions').optional().isArray()
], async (req, res) => {
  logDebug('🔵 Create admin route hit')
  try {
    logDebug('🔵 Validating request body...')
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      logDebug('❌ Validation errors:', errors.array())
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      })
    }
    
    const { email, password, name, permissions = [] } = req.body
    
    logDebug('📝 Creating admin:', { email, name, permissions })
    
    // Check if user exists
    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered' 
      })
    }
    
    // Create admin (not super admin)
    const admin = new User({
      email,
      password,
      name,
      role: 'admin',
      isSuperAdmin: false,
      permissions,
      isEmailVerified: true,
      isActive: true,
      mustChangePassword: true // Force password change for new admins
    })
    
    await admin.save()
    logDebug('✅ Admin created:', admin.email)
    
    // Send welcome email
    try {
      await emailService.sendEmail(
        email,
        'Admin Account Created',
        `
          <h2>Welcome to Clean Street Admin Panel</h2>
          <p>Your administrator account has been created.</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> ${password}</p>
          <p><strong>Note:</strong> You must change your password on first login.</p>
          <p>Login URL: ${process.env.ADMIN_FRONTEND_URL || 'http://localhost:3000/admin'}</p>
          <hr>
          <p><em>This is an automated message. Do not reply.</em></p>
        `
      )
      logDebug('📧 Welcome email sent to:', email)
    } catch (emailError) {
      logWarn('⚠️  Email send failed (non-critical):', emailError.message)
      // Don't fail the request if email fails
    }
    
    res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      admin: {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        permissions: admin.permissions
      }
    })
    
  } catch (error) {
    if (!isProd) {
      console.error('❌ Create admin error:', error.message, error.stack)
    } else {
      console.error('❌ Create admin error:', error.message)
    }
    
    // Handle specific errors
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered'
      })
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to create admin',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

// 5. Get All Admins (super admin only)
router.get('/admins', isSuperAdmin, async (req, res) => {
  try {
    const admins = await User.find({
      role: { $in: ['admin', 'super-admin'] }
    }).select('-password -twoFactorSecret')
    
    res.json({
      success: true,
      admins
    })
    
  } catch (error) {
    console.error('Get admins error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admins'
    })
  }
})

// 6. Update Admin Permissions (super admin only)
router.put('/admins/:id/permissions', isSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { permissions } = req.body
    
    const admin = await User.findOne({
      _id: id,
      role: { $in: ['admin', 'super-admin'] }
    })
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: 'Admin not found'
      })
    }
    
    // Cannot modify super admin permissions
    if (admin.isSuperAdmin) {
      return res.status(400).json({
        success: false,
        error: 'Cannot modify super admin permissions'
      })
    }
    
    // Cannot modify yourself
    if (admin._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Cannot modify your own permissions'
      })
    }
    
    admin.permissions = permissions
    await admin.save()
    
    res.json({
      success: true,
      message: 'Permissions updated successfully',
      admin: {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        permissions: admin.permissions
      }
    })
    
  } catch (error) {
    console.error('Update permissions error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to update permissions'
    })
  }
})

// ========== ADMIN DASHBOARD ROUTES ==========
// Get users (admin or super-admin)
router.get('/users', isAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 0
    const query = {}

    const usersQuery = User.find(query)
      .select('-password -twoFactorSecret')
      .sort({ createdAt: -1 })

    if (limit > 0) {
      usersQuery.limit(limit)
    }

    const users = await usersQuery.exec()

    res.json({
      success: true,
      users
    })
  } catch (error) {
    console.error('Get users error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    })
  }
})

// Get specific user activity
router.get('/users/:id/activity', isAdmin, async (req, res) => {
  try {
    // Get user's reports
    const reports = await Report.find({ userId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(10)
    
    res.json({
      success: true,
      reports,
      stats: {
        totalReports: reports.length,
        resolvedReports: reports.filter(r => r.status === 'resolved').length
      }
    })
  } catch (error) {
    console.error('Get user activity error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user activity'
    })
  }
})

// Update user active status (admin or super-admin)
router.put('/users/:id/status', isAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { isActive } = req.body

    const user = await User.findById(id)

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    // Prevent disabling super admin unless caller is super admin
    if (user.isSuperAdmin && !req.user.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only a super admin can modify another super admin'
      })
    }

    user.isActive = !!isActive
    await user.save()

    res.json({
      success: true,
      message: 'User status updated',
      user: {
        id: user._id,
        email: user.email,
        isActive: user.isActive
      }
    })
  } catch (error) {
    console.error('Update user status error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to update user status'
    })
  }
})

// Delete user (admin or super-admin)
router.delete('/users/:id', isAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const user = await User.findById(id)

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    // Prevent deleting super admin unless caller is super admin
    if (user.isSuperAdmin && !req.user.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only a super admin can delete another super admin'
      })
    }

    // Prevent deleting yourself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account'
      })
    }

    await User.deleteOne({ _id: id })

    res.json({
      success: true,
      message: 'User deleted successfully'
    })
  } catch (error) {
    console.error('Delete user error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    })
  }
})

// Basic dashboard stats (optional)
router.get('/dashboard/stats', isAdmin, async (_req, res) => {
  try {
    const [totalUsers, activeUsers, totalAdmins, totalSuperAdmins] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ role: { $in: ['admin', 'super-admin'] } }),
      User.countDocuments({ isSuperAdmin: true })
    ])

    res.json({
      success: true,
      stats: {
        totalUsers,
        activeUsers,
        totalAdmins,
        totalSuperAdmins
      }
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard stats'
    })
  }
})

// ========== VOLUNTEER MANAGEMENT ROUTES ==========

// Get pending volunteers (newly registered, awaiting admin verification)
router.get('/volunteers/pending', isAdmin, async (req, res) => {
  try {
    // Get all volunteers with pending status
    const pendingVolunteers = await User.find({
      role: 'volunteer',
      volunteer_status: 'pending'
    })
      .select('-password -twoFactorSecret -emailVerificationOTP -emailVerificationExpiry')
      .sort({ createdAt: -1 })

    res.json({
      success: true,
      pendingVolunteers,
      count: pendingVolunteers.length
    })
  } catch (error) {
    console.error('Get pending volunteers error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pending volunteers'
    })
  }
})

// Verify/Approve a basic volunteer (admin verification)
router.post('/volunteers/:id/verify', isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)

    if (!user) {
      return res.status(404).json({ success: false, error: 'Volunteer not found' })
    }

    if (user.role !== 'volunteer') {
      return res.status(400).json({ success: false, error: 'User is not a volunteer' })
    }

    // Update volunteer status to active (verified)
    user.volunteer_status = 'active'
    await user.save()

    // Update or create volunteer profile
    await VolunteerProfile.findOneAndUpdate(
      { userId: user._id },
      { 
        status: 'active',
        tier: user.volunteer_tier || 'basic'
      },
      { new: true, upsert: true }
    )

    // Send verification email
    try {
      await emailService.sendEmail(
        user.email,
        'Volunteer Verification Complete!',
        `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Welcome! Your Volunteer Account is Verified! 🎉</h2>
          <p>Dear ${user.name},</p>
          <p>Great news! Your volunteer account has been verified by our admin team.</p>
          <p>You can now access all volunteer features:</p>
          <ul style="color: #666;">
            <li>✅ Join volunteer events</li>
            <li>✅ Track your volunteer hours</li>
            <li>✅ View and respond to community reports</li>
            <li>✅ Earn badges and rewards</li>
            <li>✅ Participate in cleanup initiatives</li>
          </ul>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL || 'http://volunteer.localhost:3000'}/dashboard" 
               style="background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Go to Dashboard
            </a>
          </p>
          <p style="color: #666; font-size: 12px; border-top: 1px solid #eee; padding-top: 20px;">
            Thank you for joining Clean Street Volunteers!
          </p>
        </div>
        `
      )
    } catch (emailError) {
      logWarn('⚠️  Verification email send failed:', emailError.message)
    }

    res.json({
      success: true,
      message: 'Volunteer verified successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        volunteer_tier: user.volunteer_tier,
        volunteer_status: user.volunteer_status,
        verifiedAt: user.verifiedAt
      }
    })
  } catch (error) {
    console.error('Verify volunteer error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to verify volunteer'
    })
  }
})

// Reject/Deactivate a pending volunteer
router.post('/volunteers/:id/reject', isAdmin, [
  body('reason').optional().trim()
], async (req, res) => {
  logDebug(' Reject volunteer route hit for ID:', req.params.id)
  try {
    const user = await User.findById(req.params.id)
    logDebug(' User found:', user ? `${user.name} (${user.role})` : 'null')

    if (!user) {
      return res.status(404).json({ success: false, error: 'Volunteer not found' })
    }

    if (user.role !== 'volunteer') {
      logDebug('User is not a volunteer, role:', user.role)
      return res.status(400).json({ 
        success: false, 
        error: 'User is not a volunteer' 
      })
    }

    logDebug('🔵 Updating volunteer_status from', user.volunteer_status, 'to inactive')
    // Update volunteer status to inactive
    user.volunteer_status = 'inactive'
    logDebug('🔵 Attempting to save user...')
    await user.save()
    logDebug('✅ User saved successfully')

    // Update volunteer profile if exists
    logDebug('🔵 Updating VolunteerProfile...')
    await VolunteerProfile.findOneAndUpdate(
      { userId: user._id },
      { status: 'inactive' },
      { new: true }
    )
    logDebug('✅ VolunteerProfile updated')

    const rejectionReason = req.body.reason || 'Rejected by admin'

    // Send rejection email (best effort, don't fail if email fails)
    logDebug('🔵 Sending rejection email...')
    setImmediate(async () => {
      try {
        await emailService.sendEmail(
          user.email,
          'Volunteer Application Update',
          `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #d32f2f;">Application Status Update</h2>
            <p>Dear ${user.name},</p>
            <p>Thank you for your interest in volunteering with Clean Street. Unfortunately, your application has been temporarily put on hold.</p>
            <p><strong>Reason:</strong> ${rejectionReason}</p>
            <p>You can reapply or contact support for more information.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #666; font-size: 12px;">
              Clean Street Team
            </p>
          </div>
          `
        )
        logDebug('✅ Rejection email sent')
      } catch (emailError) {
        logWarn('⚠️  Rejection email send failed:', emailError.message)
      }
    })

    res.json({
      success: true,
      message: 'Volunteer rejected successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        volunteer_status: user.volunteer_status
      }
    })
  } catch (error) {
    console.error('❌ Reject volunteer error:', error.message)
    if (!isProd) {
      console.error('❌ Error name:', error.name)
      console.error('❌ Stack:', error.stack)
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.message
      })
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to reject volunteer',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

// Get pending volunteer applications
router.get('/volunteers/applications', isAdmin, async (req, res) => {
  try {
    const { status } = req.query
    const filter = status ? { status } : { status: 'pending' }

    const applications = await VolunteerApplication.find(filter)
      .populate('userId', 'name email phone')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })

    res.json({
      success: true,
      applications
    })
  } catch (error) {
    console.error('Get applications error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch applications'
    })
  }
})

// Approve volunteer application
router.post('/volunteers/:id/approve', isAdmin, async (req, res) => {
  try {
    const application = await VolunteerApplication.findById(req.params.id)
      .populate('userId')

    if (!application) {
      return res.status(404).json({ success: false, error: 'Application not found' })
    }

    if (application.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Application already processed' })
    }

    // Update application
    application.status = 'approved'
    application.reviewedBy = req.user._id
    application.reviewedAt = new Date()
    application.reviewNotes = req.body.notes || ''
    await application.save()

    // Update user tier
    const user = await User.findById(application.userId._id)
    user.volunteer_tier = application.applyingFor
    await user.save()

    // Update volunteer profile
    await VolunteerProfile.findOneAndUpdate(
      { userId: user._id },
      { tier: application.applyingFor }
    )

    // Send approval email
    await emailService.sendEmail(
      user.email,
      `Volunteer Application Approved - ${application.applyingFor}`,
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4caf50;">Congratulations!</h2>
        <p>Your application for <strong>${application.applyingFor}</strong> volunteer status has been approved.</p>
        <p>You now have access to additional features and can participate in more events.</p>
        <p><a href="${process.env.FRONTEND_URL}/volunteer/dashboard" style="background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Go to Dashboard</a></p>
      </div>
      `
    )

    res.json({
      success: true,
      message: 'Application approved successfully'
    })
  } catch (error) {
    console.error('Approve application error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to approve application'
    })
  }
})

// Reject volunteer application
router.post('/volunteers/applications/:id/reject', isAdmin, [
  body('reason').trim().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() })
    }

    const application = await VolunteerApplication.findById(req.params.id)
      .populate('userId')

    if (!application) {
      return res.status(404).json({ success: false, error: 'Application not found' })
    }

    if (application.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Application already processed' })
    }

    application.status = 'rejected'
    application.reviewedBy = req.user._id
    application.reviewedAt = new Date()
    application.reviewNotes = req.body.reason
    await application.save()

    // Send rejection email
    await emailService.sendEmail(
      application.userId.email,
      'Volunteer Application Update',
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Volunteer Application Update</h2>
        <p>Thank you for your interest in becoming a ${application.applyingFor} volunteer.</p>
        <p>After careful review, we are unable to approve your application at this time.</p>
        <p><strong>Reason:</strong> ${req.body.reason}</p>
        <p>You can continue to serve as a ${application.userId.volunteer_tier} volunteer and reapply in the future.</p>
      </div>
      `
    )

    res.json({
      success: true,
      message: 'Application rejected'
    })
  } catch (error) {
    console.error('Reject application error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to reject application'
    })
  }
})

// Get all volunteers
router.get('/volunteers', isAdmin, async (req, res) => {
  try {
    const { tier, status, limit = 100 } = req.query
    
    const filter = { role: 'volunteer' }
    if (tier) filter.volunteer_tier = tier
    if (status) filter.volunteer_status = status

    const volunteers = await User.find(filter)
      .select('-password -twoFactorSecret')
      .limit(Number(limit))
      .sort({ createdAt: -1 })

    // Get profiles
    const volunteerIds = volunteers.map(v => v._id)
    const profiles = await VolunteerProfile.find({ userId: { $in: volunteerIds } })

    const volunteersWithProfiles = volunteers.map(v => {
      const profile = profiles.find(p => p.userId.toString() === v._id.toString())
      return {
        ...v.toObject(),
        profile
      }
    })

    res.json({
      success: true,
      volunteers: volunteersWithProfiles
    })
  } catch (error) {
    console.error('Get volunteers error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch volunteers'
    })
  }
})

// Update volunteer tier/status
router.put('/volunteers/:id', isAdmin, async (req, res) => {
  try {
    const { volunteer_tier, volunteer_status, adminNotes } = req.body

    const user = await User.findById(req.params.id)
    if (!user || user.role !== 'volunteer') {
      return res.status(404).json({ success: false, error: 'Volunteer not found' })
    }

    if (volunteer_tier) user.volunteer_tier = volunteer_tier
    if (volunteer_status) user.volunteer_status = volunteer_status

    await user.save()

    // Update profile
    const profile = await VolunteerProfile.findOne({ userId: user._id })
    if (profile) {
      if (volunteer_tier) profile.tier = volunteer_tier
      if (volunteer_status) profile.status = volunteer_status
      if (adminNotes) profile.adminNotes = adminNotes
      await profile.save()
    }

    res.json({
      success: true,
      message: 'Volunteer updated successfully',
      volunteer: user
    })
  } catch (error) {
    console.error('Update volunteer error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to update volunteer'
    })
  }
})

// Get all volunteer events
router.get('/volunteer-events', isAdmin, async (req, res) => {
  try {
    const { status, limit = 100 } = req.query
    
    const filter = status ? { status } : {}

    const events = await Event.find(filter)
      .populate('createdBy', 'name email')
      .populate('teamLead', 'name email')
      .populate('volunteersRegistered.volunteer', 'name email')
      .limit(Number(limit))
      .sort({ 'dateTime.start': -1 })

    res.json({
      success: true,
      events
    })
  } catch (error) {
    console.error('Get events error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch events'
    })
  }
})

// Get specific volunteer's events
router.get('/volunteers/:id/events', isAdmin, async (req, res) => {
  try {
    const events = await Event.find({
      'volunteersRegistered.volunteer': req.params.id
    })
      .populate('createdBy', 'name email')
      .populate('teamLead', 'name email')
      .sort({ 'dateTime.start': -1 })

    // Calculate stats
    const stats = {
      totalEvents: events.length,
      completedEvents: events.filter(e => e.status === 'completed').length,
      upcomingEvents: events.filter(e => e.status === 'upcoming').length,
      totalHours: events.reduce((sum, event) => {
        const registration = event.volunteersRegistered.find(
          v => v.volunteer.toString() === req.params.id
        )
        return sum + (registration?.hoursCredited || 0)
      }, 0)
    }

    res.json({
      success: true,
      events,
      stats
    })
  } catch (error) {
    console.error('Get volunteer events error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch volunteer events'
    })
  }
})

// Get specific volunteer's profile details
router.get('/volunteers/:id/profile', isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -twoFactorSecret')

    if (!user || user.role !== 'volunteer') {
      return res.status(404).json({ success: false, error: 'Volunteer not found' })
    }

    const profile = await VolunteerProfile.findOne({ userId: req.params.id })

    res.json({
      success: true,
      user,
      profile
    })
  } catch (error) {
    console.error('Get volunteer profile error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch volunteer profile'
    })
  }
})

// Get specific volunteer's reports/work data
router.get('/volunteers/:id/reports', isAdmin, async (req, res) => {
  try {
    // Get volunteer's reports (work they reported)
    const reportsSubmitted = await Report.find({ userId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(20)

    // Get reports resolved by this volunteer
    const reportsResolved = await Report.find({ resolvedBy: req.params.id })
      .populate('userId', 'name email')
      .sort({ resolvedAt: -1 })
      .limit(20)

    // Group submitted reports by status
    const submittedStatsByType = {
      open: reportsSubmitted.filter(r => r.status === 'open').length,
      'in-progress': reportsSubmitted.filter(r => r.status === 'in-progress').length,
      resolved: reportsSubmitted.filter(r => r.status === 'resolved').length,
      rejected: reportsSubmitted.filter(r => r.status === 'rejected').length
    }

    res.json({
      success: true,
      reportsSubmitted,
      reportsResolved,
      stats: {
        totalSubmitted: reportsSubmitted.length,
        totalResolved: reportsResolved.length,
        ...submittedStatsByType
      }
    })
  } catch (error) {
    console.error('Get volunteer reports error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch volunteer reports'
    })
  }
})

export default router