import passport from 'passport'
import { Strategy as LocalStrategy } from 'passport-local'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import User from '../models/User.js'
import bcrypt from 'bcryptjs'

// Serialize user to session
passport.serializeUser((user, done) => {
  done(null, user.id)
})

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id)
    done(null, user)
  } catch (error) {
    done(error, null)
  }
})

// Local Strategy for both users and admins
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const user = await User.findOne({ email }).select('+password')
      
      if (!user) {
        return done(null, false, { message: 'Invalid credentials' })
      }

      // Check if account is locked
      if (user.lockUntil && user.lockUntil > Date.now()) {
        return done(null, false, { message: 'Account is locked. Try again later.' })
      }

      // Check password
      const isMatch = await user.comparePassword(password)
      
      if (!isMatch) {
        // Increment failed attempts
        user.loginAttempts = (user.loginAttempts || 0) + 1
        if (user.loginAttempts >= 5) {
          user.lockUntil = Date.now() + 15 * 60 * 1000 // 15 minutes
        }
        await user.save()
        return done(null, false, { message: 'Invalid credentials' })
      }

      // Check if email is verified
      if (!user.isEmailVerified) {
        return done(null, false, { 
          message: 'Please verify your email first. Check your inbox for the OTP.',
          requiresEmailVerification: true,
          email: user.email
        })
      }

      // Reset login attempts on successful login
      user.loginAttempts = 0
      user.lockUntil = undefined
      user.lastLogin = new Date()
      await user.save()

      return done(null, user)
    } catch (error) {
      return done(error)
    }
  }
))

// Google Strategy (only for regular users, not admins)
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy-client-id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret',
    callbackURL: '/api/auth/google/callback',
    passReqToCallback: true
  },
  async (req, accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ googleId: profile.id })
      
      if (!user) {
        // Check if user exists with same email
        user = await User.findOne({ email: profile.emails[0].value })
        
        if (user) {
          // Link Google account to existing user
          user.googleId = profile.id
          user.profilePicture = profile.photos[0].value
          user.isEmailVerified = true
          await user.save()
        } else {
          // Create new user (ONLY as citizen, never admin via Google)
          user = new User({
            googleId: profile.id,
            email: profile.emails[0].value,
            name: profile.displayName,
            profilePicture: profile.photos[0].value,
            role: 'citizen',
            isEmailVerified: true,
            lastLogin: new Date(),
            password: Math.random().toString(36).slice(-16) // Random password for OAuth users
          })
          await user.save()
        }
      } else {
        // Update last login for existing user
        user.lastLogin = new Date()
        await user.save()
      }
      
      return done(null, user)
    } catch (error) {
      return done(error, null)
    }
  }
))

export default passport