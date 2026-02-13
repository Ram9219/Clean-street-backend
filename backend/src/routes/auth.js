import express from 'express'
import passport from '../config/passport.js'
import User from '../models/User.js'
import { body, validationResult } from 'express-validator'
import { 
  authLimiter, 
  passwordResetLimiter, 
  otpRequestLimiter 
} from '../middleware/rateLimiter.js'
import emailService from '../config/email.js'
import { upload } from '../config/multer.js'
import { uploadProfileImage } from '../config/cloudinary.js'

const router = express.Router()

// ========== HELPER MIDDLEWARE ==========

// Check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next()
  }
  res.status(401).json({ 
    success: false, 
    error: 'Not authenticated' 
  })
}

// ========== USER AUTH ROUTES ==========

// 1. User Registration (Citizen only)
router.post('/register', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').trim().notEmpty(),
  body('phone').optional().isMobilePhone()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      })
    }

    const { email, password, name, phone } = req.body

    // Check if user exists
    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered' 
      })
    }

    // Create user (always as citizen)
    const user = new User({
      email,
      password,
      name,
      phone: phone || '',
      role: 'citizen',
      isEmailVerified: false // User must verify email first
    })

    await user.save()

    // Generate and send OTP
    const otp = emailService.generateOTP(6)
    user.emailVerificationOTP = otp
    user.emailVerificationExpiry = Date.now() + 10 * 60 * 1000 // 10 minutes
    await user.save()

    // Send OTP email
    const result = await emailService.sendEmail(
      email,
      'Email Verification - Clean Street',
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Verify Your Email</h2>
        <p>Welcome to Clean Street! Please use this OTP to verify your email address:</p>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px;">
          <h1 style="margin: 0; color: #1976d2; letter-spacing: 5px; font-size: 2em;">${otp}</h1>
        </div>
        <p style="color: #666;">This OTP is valid for 10 minutes. Do not share it with anyone.</p>
        <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
      </div>
      `
    )

    if (!result.success) {
      await User.deleteOne({ _id: user._id })
      return res.status(503).json({
        success: false,
        error: 'Email service unavailable. Please try again later.'
      })
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful. Check your email for OTP verification.',
      email: user.email,
      emailSent: true,
      emailMessageId: result.messageId || null
    })
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ 
      success: false,
      error: 'Registration failed' 
    })
  }
})

// 2. User Login (Manual) - with rate limiting
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
    
    // Check if email is verified
    if (!user.isEmailVerified) {
      return res.status(403).json({ 
        success: false,
        error: 'Please verify your email first. Check your inbox for the OTP.',
        requiresEmailVerification: true
      })
    }
    
    // Check if user is trying to access admin via user login
    if (user.role === 'admin' && req.path.includes('/admin') === false) {
      return res.status(403).json({ 
        success: false,
        error: 'Admin must login via admin portal',
        adminLoginUrl: '/admin/login'
      })
    }
    
    req.login(user, (err) => {
      if (err) {
        return next(err)
      }
      
      res.json({
        success: true,
        message: 'Login successful',
        user: {
          _id: user._id,
          id: user._id, // Keep both for compatibility
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

// 3. Verify Email with OTP
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

    const user = await User.findOne({ email })

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

    // Check if OTP has expired
    if (!user.emailVerificationExpiry || user.emailVerificationExpiry < Date.now()) {
      return res.status(400).json({
        success: false,
        error: 'OTP has expired. Please register again to get a new OTP.'
      })
    }

    // Check if OTP matches
    if (user.emailVerificationOTP !== otp) {
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP. Please try again.'
      })
    }

    // Mark email as verified
    user.isEmailVerified = true
    user.emailVerificationOTP = undefined
    user.emailVerificationExpiry = undefined
    await user.save()

    res.json({
      success: true,
      message: 'Email verified successfully. You can now login.',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        volunteer_tier: user.volunteer_tier,
        volunteer_status: user.volunteer_status
      }
    })
  } catch (error) {
    console.error('Email verification error:', error)
    res.status(500).json({
      success: false,
      error: 'Verification failed'
    })
  }
})

// 4. Resend OTP
router.post('/resend-otp', otpRequestLimiter, [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      })
    }

    const { email } = req.body
    const user = await User.findOne({ email })

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

    // Generate new OTP
    const otp = emailService.generateOTP(6)
    user.emailVerificationOTP = otp
    user.emailVerificationExpiry = Date.now() + 10 * 60 * 1000 // 10 minutes
    await user.save()

    // Send OTP email
    const result = await emailService.sendEmail(
      email,
      'Email Verification - Clean Street',
      `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Verify Your Email</h2>
        <p>Here's your new OTP to verify your email address:</p>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px;">
          <h1 style="margin: 0; color: #1976d2; letter-spacing: 5px; font-size: 2em;">${otp}</h1>
        </div>
        <p style="color: #666;">This OTP is valid for 10 minutes.</p>
      </div>
      `
    )

    if (!result.success) {
      return res.status(503).json({
        success: false,
        error: 'Email service unavailable. Please try again later.'
      })
    }

    res.json({
      success: true,
      message: 'OTP sent to your email',
      emailMessageId: result.messageId || null,
      emailSender: process.env.BREVO_SENDER_EMAIL || process.env.SMTP_FROM || null,
      emailSenderName: process.env.BREVO_SENDER_NAME || 'Clean Street'
    })
  } catch (error) {
    console.error('Resend OTP error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to resend OTP'
    })
  }
})

// 5. Google OAuth Login (Users only) - UNCHANGED
router.get('/google', passport.authenticate('google', { 
  scope: ['profile', 'email'],
  prompt: 'select_account'
}))

router.get('/google/callback', 
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=auth_failed`
  }),
  (req, res) => {
    // Redirect based on role
    if (req.user.role === 'admin') {
      res.redirect(`${process.env.ADMIN_FRONTEND_URL || 'http://localhost:3000/admin'}/dashboard`)
    } else {
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard`)
    }
  }
)

// 4. Logout
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ 
        success: false,
        error: 'Logout failed' 
      })
    }
    res.json({ 
      success: true,
      message: 'Logged out successfully' 
    })
  })
})

// 5. Get Current User
router.get('/me', isAuthenticated, (req, res) => {
  res.json({
    success: true,
    user: {
      _id: req.user._id,
      id: req.user._id, // Keep both for compatibility
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      profilePicture: req.user.profilePicture,
      phone: req.user.phone,
      isEmailVerified: req.user.isEmailVerified,
      volunteer_status: req.user.volunteer_status,
      volunteer_tier: req.user.volunteer_tier,
      isSuperAdmin: req.user.isSuperAdmin,
      mustChangePassword: req.user.mustChangePassword,
      requiresPasswordChange: req.user.mustChangePassword || false,
      stats: req.user.stats
    }
  })
})

// Upload profile picture
router.post('/upload-profile-picture', isAuthenticated, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      })
    }

    const fileName = `${req.user._id}-${Date.now()}-${Math.random().toString(36).substring(7)}`
    const uploadResult = await uploadProfileImage(req.file.buffer, fileName)

    const user = await User.findById(req.user._id)
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    user.profilePicture = uploadResult.secure_url
    await user.save()

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      image: {
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id
      },
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        profilePicture: user.profilePicture,
        phone: user.phone,
        isEmailVerified: user.isEmailVerified
      }
    })
  } catch (error) {
    console.error('Profile picture upload error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload profile picture'
    })
  }
})

// Update user profile
router.put('/profile', isAuthenticated, async (req, res) => {
  try {
    const { name, phone, profilePicture } = req.body
    const user = await User.findById(req.user._id)

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      })
    }

    // Update allowed fields
    if (name) user.name = name
    if (phone) user.phone = phone
    if (profilePicture) user.profilePicture = profilePicture

    await user.save()

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        profilePicture: user.profilePicture,
        isEmailVerified: user.isEmailVerified
      }
    })
  } catch (error) {
    console.error('Profile update error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    })
  }
})

// 6. Forgot Password - Send OTP (with rate limiting)
router.post('/forgot-password', passwordResetLimiter, [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      })
    }

    const { email } = req.body
    const user = await User.findOne({ email })

    // Do not reveal account existence for security
    if (!user) {
      return res.json({ 
        success: true, 
        message: 'If an account exists, a reset code has been sent.' 
      })
    }

    // Generate OTP
    const otp = emailService.generateOTP()

    // Store OTP with 15-minute expiry
    user.resetPasswordOTP = otp
    user.resetPasswordExpiry = new Date(Date.now() + 15 * 60 * 1000)
    await user.save()

    // Send OTP email
    const emailResult = await emailService.sendPasswordResetOTP(email, otp)
    
    if (!emailResult.success) {
      // Clear OTP if email fails
      user.resetPasswordOTP = undefined
      user.resetPasswordExpiry = undefined
      await user.save()
      
      throw new Error('Failed to send email')
    }

    res.json({ 
      success: true, 
      message: 'If an account exists, a reset code has been sent.',
      expiryMinutes: 15
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process request' 
    })
  }
})

// 7. Verify Reset OTP
router.post('/verify-reset-otp', [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      })
    }

    const { email, otp } = req.body
    const user = await User.findOne({ email }).select('+resetPasswordOTP +resetPasswordExpiry')

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      })
    }

    // Check if OTP exists and is not expired
    if (!user.resetPasswordOTP || !user.resetPasswordExpiry) {
      return res.status(400).json({ 
        success: false, 
        error: 'No password reset request found. Please request a new OTP.' 
      })
    }

    // Check if OTP matches and is not expired
    if (user.resetPasswordOTP !== otp) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid OTP. Please check and try again.' 
      })
    }

    if (user.resetPasswordExpiry < new Date()) {
      // Clear expired OTP
      user.resetPasswordOTP = undefined
      user.resetPasswordExpiry = undefined
      await user.save()
      
      return res.status(400).json({ 
        success: false, 
        error: 'OTP has expired. Please request a new one.' 
      })
    }

    // OTP is valid - return success
    res.json({ 
      success: true, 
      message: 'OTP verified successfully',
      expiresAt: user.resetPasswordExpiry
    })
  } catch (error) {
    console.error('Verify OTP error:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Failed to verify OTP' 
    })
  }
})

// 8. Reset Password (after OTP verification)
router.post('/reset-password', [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 }),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      })
    }

    const { email, otp, newPassword } = req.body
    const user = await User.findOne({ email }).select('+password +resetPasswordOTP +resetPasswordExpiry')

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      })
    }

    // Verify OTP again (for security)
    if (!user.resetPasswordOTP || !user.resetPasswordExpiry) {
      return res.status(400).json({ 
        success: false, 
        error: 'No password reset request found. Please start the process again.' 
      })
    }

    if (user.resetPasswordOTP !== otp) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid OTP. Please verify OTP again.' 
      })
    }

    if (user.resetPasswordExpiry < new Date()) {
      // Clear expired OTP
      user.resetPasswordOTP = undefined
      user.resetPasswordExpiry = undefined
      await user.save()
      
      return res.status(400).json({ 
        success: false, 
        error: 'OTP has expired. Please request a new one.' 
      })
    }

    // Set new password
    user.password = newPassword
    
    // Clear OTP fields
    user.resetPasswordOTP = undefined
    user.resetPasswordExpiry = undefined
    
    await user.save()

    // Send confirmation email
    await emailService.sendPasswordChangedConfirmation(email)

    res.json({ 
      success: true, 
      message: 'Password reset successful' 
    })
  } catch (error) {
    console.error('Reset password error:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Password reset failed' 
    })
  }
})

// 9. Resend Verification OTP (with rate limiting)
router.post('/resend-verification', otpRequestLimiter, [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      })
    }

    const { email } = req.body
    const user = await User.findOne({ email })

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

    // Generate verification OTP
    const otp = emailService.generateOTP()

    user.verificationOTP = otp
    user.verificationOTPExpiry = new Date(Date.now() + 15 * 60 * 1000)
    await user.save()

    // Send verification email
    const emailResult = await emailService.sendVerificationOTP(email, otp)
    
    if (!emailResult.success) {
      // Clear OTP if email fails
      user.verificationOTP = undefined
      user.verificationOTPExpiry = undefined
      await user.save()
      
      throw new Error('Failed to send email')
    }

    res.json({ 
      success: true, 
      message: 'Verification OTP sent successfully',
      expiryMinutes: 15
    })
  } catch (error) {
    console.error('Resend verification error:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Failed to resend verification OTP' 
    })
  }
})

// 10. Verify Email with OTP
router.post('/verify-email', [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      })
    }

    const { email, otp } = req.body
    const user = await User.findOne({ email }).select('+verificationOTP +verificationOTPExpiry')

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

    // Verify OTP
    if (!user.verificationOTP || user.verificationOTP !== otp) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid verification OTP' 
      })
    }

    if (!user.verificationOTPExpiry || user.verificationOTPExpiry < new Date()) {
      // Clear expired OTP
      user.verificationOTP = undefined
      user.verificationOTPExpiry = undefined
      await user.save()
      
      return res.status(400).json({ 
        success: false, 
        error: 'Verification OTP has expired. Please request a new one.' 
      })
    }

    // Mark email as verified
    user.isEmailVerified = true
    user.verificationOTP = undefined
    user.verificationOTPExpiry = undefined
    await user.save()

    // Auto-login after verification
    req.login(user, (err) => {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          error: 'Auto login failed' 
        })
      }
      
      res.json({
        success: true,
        message: 'Email verified successfully',
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          isEmailVerified: user.isEmailVerified
        }
      })
    })
  } catch (error) {
    console.error('Email verification error:', error)
    res.status(500).json({ 
      success: false, 
      error: 'Email verification failed' 
    })
  }
})

export default router