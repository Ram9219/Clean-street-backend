#!/usr/bin/env node
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import readline from 'readline'
import crypto from 'crypto'

// Get current directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables from root .env
dotenv.config({ path: join(dirname(__dirname), '.env') })

// Dynamically import User model
import { pathToFileURL } from 'url'
const modelsPath = join(dirname(__dirname), 'src', 'models', 'User.js')
const UserModule = await import(pathToFileURL(modelsPath).href)
const User = UserModule.default

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const question = (query) => new Promise((resolve) => rl.question(query, resolve))

const createSuperAdmin = async (options = {}) => {
  let mongoConnection = null
  
  try {
    console.log('===================================')
    console.log('   SUPER ADMIN CREATION TOOL')
    console.log('===================================\n')
    
    // Connect to MongoDB
    console.log('🔗 Connecting to MongoDB...')
    mongoConnection = await mongoose.connect(process.env.MONGODB_URI)
    console.log('✅ Connected to MongoDB\n')
    
    // Check if super admin already exists
    console.log('🔍 Checking for existing super admin...')
    const existingSuperAdmin = await User.findOne({ isSuperAdmin: true })
    
    if (existingSuperAdmin && !options.force) {
      console.log('\n❌ Super admin already exists!')
      console.log('📧 Email:', existingSuperAdmin.email)
      console.log('👤 Name:', existingSuperAdmin.name)
      console.log('🆔 ID:', existingSuperAdmin._id)
      console.log('\n⚠️  Use --force flag to create another super admin')
      return {
        success: false,
        error: 'Super admin already exists'
      }
    }
    
    // Get credentials
    let email, password, name
    
    if (options.email && options.password && options.name) {
      // Use provided credentials
      email = options.email
      password = options.password
      name = options.name
    } else {
      console.log('📝 Enter super admin details:\n')
      
      email = await question('Email: ')
      if (!email.includes('@')) {
        throw new Error('Invalid email format')
      }
      
      // Check if email already exists
      const existingUser = await User.findOne({ email })
      if (existingUser && !options.force) {
        throw new Error(`Email ${email} is already registered`)
      }
      
      name = await question('Full Name: ')
      if (!name.trim()) {
        throw new Error('Name cannot be empty')
      }
      
      password = await question('Password (min 8 chars): ')
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters')
      }
      
      const confirmPassword = await question('Confirm Password: ')
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match')
      }
    }
    
    console.log('\n🔄 Creating super admin...')
    
    // Create super admin
    const superAdmin = new User({
      email: email.toLowerCase().trim(),
      password: password,
      name: name.trim(),
      role: 'super-admin',
      isSuperAdmin: true,
      permissions: ['all'],
      isEmailVerified: true,
      isActive: true,
      mustChangePassword: process.env.FORCE_PASSWORD_CHANGE === 'true'
    })
    
    await superAdmin.save()
    
    // Generate 2FA secret if enabled
    let twoFactorSecret = null
    if (process.env.ENABLE_SUPER_ADMIN_2FA === 'true') {
      twoFactorSecret = crypto.randomBytes(20).toString('hex')
      superAdmin.twoFactorSecret = twoFactorSecret
      await superAdmin.save()
    }
    
    console.log('\n' + '='.repeat(50))
    console.log('✅ SUPER ADMIN CREATED SUCCESSFULLY')
    console.log('='.repeat(50))
    console.log('📧 Email:', superAdmin.email)
    console.log('👤 Name:', superAdmin.name)
    console.log('🎭 Role:', superAdmin.role)
    console.log('🔑 Permissions:', superAdmin.permissions.join(', '))
    console.log('🆔 User ID:', superAdmin._id)
    console.log('📅 Created:', superAdmin.createdAt)
    console.log('='.repeat(50))
    
    if (superAdmin.mustChangePassword) {
      console.log('\n⚠️  IMPORTANT: User must change password on first login!')
    }
    
    if (twoFactorSecret) {
      console.log('\n🔒 2FA Secret:', twoFactorSecret)
      console.log('⚠️  Save this 2FA secret securely!')
    }
    
    console.log('\n🔒 SECURITY NOTES:')
    console.log('1. Store these credentials in a secure password manager')
    console.log('2. Enable 2FA for this account immediately')
    console.log('3. Change the password regularly')
    console.log('4. Limit access to this super admin account')
    console.log('\n🚀 Setup completed successfully!\n')
    
    return {
      success: true,
      admin: {
        id: superAdmin._id,
        email: superAdmin.email,
        name: superAdmin.name,
        role: superAdmin.role
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    return {
      success: false,
      error: error.message
    }
  } finally {
    if (rl) rl.close()
    if (mongoConnection) {
      await mongoose.disconnect()
      console.log('🔗 MongoDB connection closed')
    }
  }
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const options = {}
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      options.email = args[++i]
    } else if (args[i] === '--password' && args[i + 1]) {
      options.password = args[++i]
    } else if (args[i] === '--name' && args[i + 1]) {
      options.name = args[++i]
    } else if (args[i] === '--force') {
      options.force = true
    } else if (args[i] === '--help') {
      console.log(`
Super Admin Creation Tool
=========================
Usage: node scripts/create-super-admin.js [options]

Options:
  --email <email>      Admin email address
  --password <pass>    Admin password (min 8 chars)
  --name <name>        Admin full name
  --force              Force creation even if super admin exists
  --help               Show this help message

Examples:
  node scripts/create-super-admin.js
  node scripts/create-super-admin.js --email admin@example.com --password "Pass123!" --name "Admin Name"
      `)
      process.exit(0)
    }
  }
  
  createSuperAdmin(options).then(result => {
    if (!result.success) {
      process.exit(1)
    }
    process.exit(0)
  })
}

export default createSuperAdmin