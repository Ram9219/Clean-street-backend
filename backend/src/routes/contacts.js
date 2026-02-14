import express from 'express'
import { body, validationResult } from 'express-validator'
import Contact from '../models/Contact.js'
import User from '../models/User.js'
import emailService from '../config/email.js'
import { contactLimiter } from '../middleware/rateLimiter.js'

const router = express.Router()

// Helper: Check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next()
  }
  res.status(401).json({
    success: false,
    error: 'Not authenticated'
  })
}

// Helper: Check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.isSuperAdmin)) {
    return next()
  }
  res.status(403).json({
    success: false,
    error: 'Admin access required'
  })
}

// ========== PUBLIC ROUTES ==========

/**
 * POST /api/contacts
 * Submit a contact form
 * Rate limited to prevent spam
 */
router.post(
  '/',
  contactLimiter,
  [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Name is required')
      .isLength({ max: 100 })
      .withMessage('Name must not exceed 100 characters'),
    body('email')
      .trim()
      .isEmail()
      .withMessage('Invalid email format')
      .normalizeEmail(),
    body('subject')
      .trim()
      .notEmpty()
      .withMessage('Subject is required')
      .isLength({ max: 200 })
      .withMessage('Subject must not exceed 200 characters'),
    body('message')
      .trim()
      .notEmpty()
      .withMessage('Message is required')
      .isLength({ min: 10 })
      .withMessage('Message must be at least 10 characters')
      .isLength({ max: 5000 })
      .withMessage('Message must not exceed 5000 characters')
  ],
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        })
      }

      const { name, email, subject, message } = req.body

      // Create contact document
      const contact = new Contact({
        name,
        email,
        subject,
        message
      })

      await contact.save()

      // Send notification email to admin (non-blocking)
      try {
        // Get admin emails - send to all admins
        const admins = await User.find({
          $or: [{ role: 'admin' }, { isSuperAdmin: true }]
        }).select('email name')

        if (admins.length > 0) {
          const adminEmails = admins.map(admin => admin.email).join(', ')

          const htmlContent = `
            <h2>New Contact Form Submission</h2>
            <p><strong>From:</strong> ${name} (${email})</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <hr>
            <p><strong>Message:</strong></p>
            <p>${message.replace(/\n/g, '<br>')}</p>
            <hr>
            <p><small>Submitted on ${new Date().toLocaleString()}</small></p>
            <p><a href="${process.env.ADMIN_FRONTEND_URL || 'https://admin.example.com'}/contacts/${contact._id}">View in Admin Panel</a></p>
          `

          await emailService.sendEmail(
            adminEmails,
            `New Contact Form: ${subject}`,
            htmlContent
          )
        }
      } catch (emailError) {
        // Log but don't fail - contact was already saved
        console.error('Failed to send admin notification:', emailError.message)
      }

      // Send confirmation email to user (non-blocking)
      try {
        const userHtmlContent = `
          <h2>Thank you for contacting us</h2>
          <p>Hello ${name},</p>
          <p>We have received your message and will get back to you as soon as possible.</p>
          <hr>
          <p><strong>Your message:</strong></p>
          <p>${message.replace(/\n/g, '<br>')}</p>
          <hr>
          <p>Best regards,<br>Clean Street Team</p>
        `

        await emailService.sendEmail(
          email,
          'We received your contact form',
          userHtmlContent
        )
      } catch (emailError) {
        // Log but don't fail - contact was already saved
        console.error('Failed to send user confirmation:', emailError.message)
      }

      res.status(201).json({
        success: true,
        message: 'Your message has been received. We will get back to you soon.',
        contactId: contact._id
      })
    } catch (error) {
      console.error('Contact form error:', error)
      res.status(500).json({
        success: false,
        message: 'Failed to send message. Please try again later.'
      })
    }
  }
)

// ========== ADMIN ROUTES ==========

/**
 * GET /api/contacts
 * Get all contact submissions (admin only)
 */
router.get('/', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 10, sort = '-createdAt' } = req.query

    // Build filter
    const filter = {}
    if (status) {
      filter.status = status
    }

    const skip = (page - 1) * limit

    const [contacts, total] = await Promise.all([
      Contact.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .exec(),
      Contact.countDocuments(filter)
    ])

    res.json({
      success: true,
      data: contacts,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Get contacts error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contacts'
    })
  }
})

/**
 * GET /api/contacts/:id
 * Get a single contact (admin only)
 */
router.get('/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id)

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found'
      })
    }

    // Mark as read if not already
    if (contact.status === 'new') {
      contact.status = 'read'
      await contact.save()
    }

    res.json({
      success: true,
      data: contact
    })
  } catch (error) {
    console.error('Get contact error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contact'
    })
  }
})

/**
 * PATCH /api/contacts/:id
 * Update contact (add response, change status) (admin only)
 */
router.patch(
  '/:id',
  isAuthenticated,
  isAdmin,
  [
    body('status')
      .optional()
      .isIn(['new', 'read', 'replied', 'resolved'])
      .withMessage('Invalid status'),
    body('response')
      .optional()
      .trim()
      .isLength({ max: 5000 })
      .withMessage('Response must not exceed 5000 characters')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        })
      }

      const { status, response } = req.body
      const contact = await Contact.findById(req.params.id)

      if (!contact) {
        return res.status(404).json({
          success: false,
          message: 'Contact not found'
        })
      }

      // Update fields
      if (status) {
        contact.status = status
      }

      if (response) {
        contact.response = response
        contact.responseDate = new Date()
        contact.respondedBy = req.user._id
        contact.status = 'replied'
      }

      await contact.save()

      // Send reply email to user if response is provided
      if (response) {
        try {
          const htmlContent = `
            <h2>Response to Your Contact Form</h2>
            <p>Hello ${contact.name},</p>
            <p>Thank you for contacting us. Here is our response to your message:</p>
            <hr>
            <p>${response.replace(/\n/g, '<br>')}</p>
            <hr>
            <p>Best regards,<br>Clean Street Team</p>
          `

          await emailService.sendEmail(
            contact.email,
            `Re: ${contact.subject}`,
            htmlContent
          )
        } catch (emailError) {
          console.error('Failed to send reply email:', emailError.message)
          // Don't fail the update if email fails
        }
      }

      res.json({
        success: true,
        message: 'Contact updated successfully',
        data: contact
      })
    } catch (error) {
      console.error('Update contact error:', error)
      res.status(500).json({
        success: false,
        message: 'Failed to update contact'
      })
    }
  }
)

/**
 * DELETE /api/contacts/:id
 * Delete a contact (admin only)
 */
router.delete('/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id)

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found'
      })
    }

    res.json({
      success: true,
      message: 'Contact deleted successfully'
    })
  } catch (error) {
    console.error('Delete contact error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to delete contact'
    })
  }
})

/**
 * GET /api/contacts/stats/overview
 * Get contact statistics (admin only)
 */
router.get('/stats/overview', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const [total, newCount, repliedCount, resolvedCount] = await Promise.all([
      Contact.countDocuments(),
      Contact.countDocuments({ status: 'new' }),
      Contact.countDocuments({ status: 'replied' }),
      Contact.countDocuments({ status: 'resolved' })
    ])

    res.json({
      success: true,
      data: {
        total,
        new: newCount,
        replied: repliedCount,
        resolved: resolvedCount
      }
    })
  } catch (error) {
    console.error('Get stats error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    })
  }
})

export default router
