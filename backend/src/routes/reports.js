import express from 'express'
import Report from '../models/Report.js'
import Notification from '../models/Notification.js'
import User from '../models/User.js'
import { body, validationResult } from 'express-validator'
import { upload } from '../config/multer.js'
import { uploadImage, deleteImage } from '../config/cloudinary.js'

const router = express.Router()

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next()
  }
  res.status(401).json({
    success: false,
    error: 'Not authenticated'
  })
}

// Upload image to Cloudinary
router.post('/upload-image', isAuthenticated, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      })
    }

    // Generate unique filename
    const fileName = `${req.user._id}-${Date.now()}-${Math.random().toString(36).substring(7)}`

    // Upload to Cloudinary
    const uploadResult = await uploadImage(req.file.buffer, fileName)

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      image: {
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
        thumbnail: uploadResult.secure_url.replace('/upload/', '/upload/w_300,h_300,c_fill/')
      }
    })
  } catch (error) {
    console.error('Image upload error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload image'
    })
  }
})

// Create a new report
router.post('/create', isAuthenticated, [
  body('category').isIn(['garbage', 'pothole', 'water', 'streetlight', 'park', 'sewage', 'vandalism', 'other']),
  body('title').trim().notEmpty().isLength({ min: 5 }),
  body('description').trim().notEmpty().isLength({ min: 10 }),
  body('address').trim().notEmpty(),
  body('locationDetails').optional().isString().isLength({ max: 500 }),
  body('latitude').isFloat(),
  body('longitude').isFloat(),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('images').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      })
    }

    const {
      category,
      title,
      description,
      priority = 'medium',
      latitude,
      longitude,
      address,
      locationDetails,
      isAnonymous = false,
      allowComments = true,
      images = []
    } = req.body

    // Validate images array
    let processedImages = []
    if (images && Array.isArray(images)) {
      processedImages = images.map(img => ({
        url: img.url,
        public_id: img.public_id,
        uploadedAt: new Date()
      }))
    }

    const report = new Report({
      userId: req.user._id,
      category,
      title,
      description,
      priority,
      location: {
        type: 'Point',
        coordinates: [longitude, latitude]
      },
      latitude,
      longitude,
      address,
      locationDetails,
      isAnonymous,
      allowComments,
      images: processedImages
    })

    await report.save()

    try {
      const recipients = await User.find({
        role: { $in: ['citizen', 'volunteer'] },
        isActive: true,
        _id: { $ne: req.user._id }
      }).select('_id').lean()

      if (recipients.length > 0) {
        const notifications = recipients.map(userItem => ({
          userId: userItem._id,
          title: 'New issue reported',
          message: report.title,
          link: '/community',
          type: 'issue'
        }))
        await Notification.insertMany(notifications)
      }
    } catch (notifyError) {
      console.error('Notification error:', notifyError)
    }

    res.status(201).json({
      success: true,
      message: 'Report submitted successfully',
      report: {
        id: report._id,
        category: report.category,
        title: report.title,
        status: report.status,
        images: report.images,
        createdAt: report.createdAt
      }
    })
  } catch (error) {
    console.error('Report creation error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to create report'
    })
  }
})

// Get user's reports
router.get('/my-reports', isAuthenticated, async (req, res) => {
  try {
    const reports = await Report.find({ userId: req.user._id })
      .select('-comments')
      .sort({ createdAt: -1 })
      .lean()

    res.json({
      success: true,
      reports,
      count: reports.length
    })
  } catch (error) {
    console.error('Fetch reports error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reports'
    })
  }
})

// Get single report by ID
router.get('/:id', async (req, res) => {
  try {
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    ).populate('userId', 'name email profilePicture')

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      })
    }

    res.json({
      success: true,
      report
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch report'
    })
  }
})

// Update report status (admin only)
router.put('/:id/status', isAuthenticated, [
  body('status').isIn(['open', 'in-progress', 'resolved', 'rejected'])
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      })
    }

    const { status } = req.body
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      {
        status,
        ...(status === 'resolved' && { resolvedAt: new Date(), resolvedBy: req.user._id })
      },
      { new: true }
    )

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      })
    }

    try {
      if (report.userId) {
        await Notification.create({
          userId: report.userId,
          title: 'Issue status updated',
          message: `${report.title} is now ${status}`,
          link: '/my-reports',
          type: 'status'
        })
      }
    } catch (notifyError) {
      console.error('Notification error:', notifyError)
    }

    res.json({
      success: true,
      message: 'Report status updated',
      report
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update report'
    })
  }
})

// Get all reports (public)
router.get('/', async (req, res) => {
  try {
    const { category, status, priority, limit = 50, page = 1 } = req.query

    const filter = {}
    if (category) filter.category = category
    if (status) filter.status = status
    if (priority) filter.priority = priority

    const skip = (page - 1) * limit

    const reports = await Report.find(filter)
      .select('-comments')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('userId', 'name profilePicture isAnonymous')
      .lean()

    const total = await Report.countDocuments(filter)

    res.json({
      success: true,
      reports,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reports'
    })
  }
})

// Get all reports for community page with full details
router.get('/community/feed', async (req, res) => {
  try {
    const { category, limit = 20, page = 1, search } = req.query
    const skip = (page - 1) * limit

    const filter = {}
    if (category && category !== 'all') filter.category = category
    
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } }
      ]
    }

    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('userId', 'name profilePicture _id')
      .populate('likes', 'name')
      .select('-isAnonymous')
      .lean()

    const total = await Report.countDocuments(filter)

    res.json({
      success: true,
      reports,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Community feed error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch community feed'
    })
  }
})

// Get report with all comments
router.get('/community/post/:id', async (req, res) => {
  try {
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    )
      .populate('userId', 'name profilePicture email')
      .populate('likes', 'name profilePicture')
      .populate('comments.userId', 'name profilePicture')

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      })
    }

    res.json({
      success: true,
      report
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch report'
    })
  }
})

// Add comment to report
router.post('/:id/comment', isAuthenticated, [
  body('text').trim().notEmpty().isLength({ min: 1, max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      })
    }

    const { text } = req.body
    const report = await Report.findById(req.params.id)

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      })
    }

    if (!report.allowComments) {
      return res.status(403).json({
        success: false,
        error: 'Comments are disabled for this report'
      })
    }

    const comment = {
      userId: req.user._id,
      userName: req.user.name,
      userProfilePicture: req.user.profilePicture,
      text,
      likes: [],
      createdAt: new Date()
    }

    report.comments.push(comment)
    await report.save()

    try {
      if (report.userId && report.userId.toString() !== req.user._id.toString()) {
        await Notification.create({
          userId: report.userId,
          title: 'New comment on your issue',
          message: report.title,
          link: `/community/post/${report._id}`,
          type: 'comment'
        })
      }
    } catch (notifyError) {
      console.error('Notification error:', notifyError)
    }

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      comment
    })
  } catch (error) {
    console.error('Add comment error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to add comment'
    })
  }
})

// Delete comment from report
router.delete('/:id/comment/:commentId', isAuthenticated, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      })
    }

    const comment = report.comments.id(req.params.commentId)

    if (!comment) {
      return res.status(404).json({
        success: false,
        error: 'Comment not found'
      })
    }

    if (comment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to delete this comment'
      })
    }

    report.comments.id(req.params.commentId).deleteOne()
    await report.save()

    res.json({
      success: true,
      message: 'Comment deleted successfully'
    })
  } catch (error) {
    console.error('Delete comment error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to delete comment'
    })
  }
})

// Like/Unlike report
router.post('/:id/like', isAuthenticated, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      })
    }

    const userLiked = report.likes.includes(req.user._id)

    if (userLiked) {
      report.likes = report.likes.filter(id => id.toString() !== req.user._id.toString())
    } else {
      report.likes.push(req.user._id)
    }

    await report.save()

    res.json({
      success: true,
      message: userLiked ? 'Like removed' : 'Report liked',
      liked: !userLiked,
      likesCount: report.likes.length
    })
  } catch (error) {
    console.error('Like error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to like report'
    })
  }
})

// Like/Unlike comment
router.post('/:id/comment/:commentId/like', isAuthenticated, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      })
    }

    const comment = report.comments.id(req.params.commentId)

    if (!comment) {
      return res.status(404).json({
        success: false,
        error: 'Comment not found'
      })
    }

    const userLiked = comment.likes.includes(req.user._id)

    if (userLiked) {
      comment.likes = comment.likes.filter(id => id.toString() !== req.user._id.toString())
    } else {
      comment.likes.push(req.user._id)
    }

    await report.save()

    res.json({
      success: true,
      message: userLiked ? 'Like removed from comment' : 'Comment liked',
      liked: !userLiked,
      likesCount: comment.likes.length
    })
  } catch (error) {
    console.error('Like comment error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to like comment'
    })
  }
})

// Increment share count
router.post('/:id/share', async (req, res) => {
  try {
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { $inc: { shares: 1 } },
      { new: true }
    )

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      })
    }

    res.json({
      success: true,
      message: 'Share count incremented',
      sharesCount: report.shares
    })
  } catch (error) {
    console.error('Share error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to record share'
    })
  }
})

// Delete report (only by report owner)
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      })
    }

    // Check if the user is the owner of the report
    if (report.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'You are not authorized to delete this report'
      })
    }

    // Delete images from Cloudinary
    if (report.images && report.images.length > 0) {
      for (const image of report.images) {
        if (image.public_id) {
          try {
            await deleteImage(image.public_id)
          } catch (err) {
            console.error('Failed to delete image from Cloudinary:', err)
          }
        }
      }
    }

    // Delete the report
    await Report.findByIdAndDelete(req.params.id)

    res.json({
      success: true,
      message: 'Report deleted successfully'
    })
  } catch (error) {
    console.error('Delete report error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to delete report'
    })
  }
})

export default router
