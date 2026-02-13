import express from 'express'
import Notification from '../models/Notification.js'

const router = express.Router()

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next()
  }
  res.status(401).json({
    success: false,
    error: 'Not authenticated'
  })
}

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const { unreadOnly, limit = 20 } = req.query
    const filter = { userId: req.user._id }

    if (unreadOnly === 'true') {
      filter.isRead = false
    }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean()

    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      isRead: false
    })

    res.json({
      success: true,
      notifications,
      unreadCount
    })
  } catch (error) {
    console.error('Fetch notifications error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications'
    })
  }
})

router.put('/:id/read', isAuthenticated, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isRead: true },
      { new: true }
    )

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      })
    }

    res.json({
      success: true,
      notification
    })
  } catch (error) {
    console.error('Mark notification read error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to update notification'
    })
  }
})

router.put('/read-all', isAuthenticated, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user._id, isRead: false },
      { isRead: true }
    )

    res.json({
      success: true
    })
  } catch (error) {
    console.error('Mark all read error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to update notifications'
    })
  }
})

export default router
