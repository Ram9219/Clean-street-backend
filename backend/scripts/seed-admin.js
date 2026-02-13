import mongoose from 'mongoose'
import User from '../models/User.js'
import dotenv from 'dotenv'

dotenv.config()

const seedSuperAdmin = async () => {
  const superAdmin = {
    email: 'superadmin@cleanstreet.com',
    password: 'TempPass123!', // Will be changed on first login
    name: 'System Administrator',
    role: 'super-admin',
    isEmailVerified: true,
    isActive: true,
    isSuperAdmin: true,
    mustChangePassword: true // Force password change on first login
  }
  
  // Check and create
  const exists = await User.findOne({ email: superAdmin.email })
  if (!exists) {
    await User.create(superAdmin)
    console.log('Super admin seeded')
  }
}

// Run when needed
mongoose.connect(process.env.MONGODB_URI)
  .then(() => seedSuperAdmin())
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err)
    process.exit(1)
  })