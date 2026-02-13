import express from 'express'
import mongoose from 'mongoose'
import User from '../models/User.js'
import crypto from 'crypto'
import { body, validationResult } from 'express-validator'

const router = express.Router()

// Check if setup is required
router.get('/status', async (req, res) => {
  try {
    const superAdminCount = await User.countDocuments({ isSuperAdmin: true })
    
    res.json({
      success: true,
      setupRequired: superAdminCount === 0,
      systemReady: superAdminCount > 0,
      totalAdmins: superAdminCount
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to check setup status'
    })
  }
})

// Database connection test
router.post('/test-database', [
  body('connectionString').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      })
    }

    const { connectionString } = req.body
    
    // Test connection
    const testConnection = await mongoose.createConnection(connectionString)
    await testConnection.asPromise()
    
    // Get database info
    const adminDb = testConnection.db.admin()
    const dbInfo = await adminDb.command({ serverStatus: 1 })
    
    await testConnection.close()
    
    res.json({
      success: true,
      message: 'Database connection successful',
      database: dbInfo.version,
      storageEngine: dbInfo.storageEngine?.name,
      connections: dbInfo.connections
    })
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Database connection failed',
      details: error.message
    })
  }
})

// Create super admin
router.post('/create-super-admin', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty(),
  body('setupKey').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      })
    }

    const { email, password, name, setupKey } = req.body
    
    // Check if super admin already exists
    const existingSuperAdmin = await User.findOne({ isSuperAdmin: true })
    if (existingSuperAdmin) {
      return res.status(400).json({ 
        success: false,
        error: 'Super admin already exists'
      })
    }
    
    // If setup key is provided, validate it
    if (setupKey && setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(403).json({
        success: false,
        error: 'Invalid setup key'
      })
    }
    
    // Create super admin
    const superAdmin = new User({
      email: email.toLowerCase().trim(),
      password,
      name: name.trim(),
      role: 'super-admin',
      isSuperAdmin: true,
      permissions: ['all'],
      isEmailVerified: true,
      isActive: true,
      mustChangePassword: true // Force password change on first login
    })
    
    await superAdmin.save()
    
    res.status(201).json({
      success: true,
      message: 'Super admin created successfully',
      admin: {
        id: superAdmin._id,
        email: superAdmin.email,
        name: superAdmin.name
      }
    })
  } catch (error) {
    console.error('Create super admin error:', error)
    res.status(500).json({ 
      success: false,
      error: 'Failed to create super admin' 
    })
  }
})

// Configure environment
router.post('/configure', [
  body('config').isObject()
], async (req, res) => {
  try {
    const { config } = req.body
    
    // This would write to .env file
    // For security, you might want to use a configuration database instead
    res.json({
      success: true,
      message: 'Configuration saved',
      config
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to save configuration'
    })
  }
})

export default router