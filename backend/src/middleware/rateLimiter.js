import rateLimit from 'express-rate-limit'

// Helper: per-user key (email preferred), falls back to IP
const getKeyGenerator = (emailField = 'email') => {
  return (req) => {
    if (req.body && req.body[emailField]) {
      return `${emailField}:${String(req.body[emailField]).toLowerCase()}`
    }
    return req.ip || req.connection?.remoteAddress || 'unknown'
  }
}

// General auth rate limiter (per email)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per windowMs
  message: {
    success: false,
    error: 'Too many attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: getKeyGenerator('email')
})

// Stricter limiter for password reset (per email)
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 requests per windowMs
  message: {
    success: false,
    error: 'Too many password reset attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getKeyGenerator('email')
})

// Limiter for OTP requests (per email)
export const otpRequestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 2, // 2 requests per windowMs
  message: {
    success: false,
    error: 'Too many OTP requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getKeyGenerator('email')
})

// API rate limiter for general endpoints (prefer userId over IP to avoid noisy IP sharing)
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // generous limit to avoid false positives for authenticated users
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user && req.user._id) {
      return `user:${req.user._id.toString()}`
    }
    return req.ip || req.connection?.remoteAddress || 'unknown'
  }
})