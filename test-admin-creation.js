// Direct test of admin creation logic
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import from correct backend directory
const User = (await import(join(__dirname, 'backend', 'src', 'models', 'User.js'))).default;

dotenv.config({ path: join(__dirname, 'backend', '.env') });

async function testAdminCreation() {
  try {
    console.log('🔵 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected');

    const testEmail = `testadmin${Date.now()}@test.com`;
    
    console.log('🔵 Creating test admin user...');
    const admin = new User({
      email: testEmail,
      password: 'TestPassword123!@#',
      name: 'Test Admin Direct',
      role: 'admin',
      isSuperAdmin: false,
      permissions: ['manage_reports', 'view_analytics'],
      isEmailVerified: true,
      isActive: true,
      mustChangePassword: true
    });
    
    console.log('🔵 Saving to database...');
    await admin.save();
    console.log('✅ Admin created successfully:', {
      id: admin._id,
      email: admin.email,
      name: admin.name,
      role: admin.role
    });
    
    console.log('🔵 Fetching admin from database...');
    const savedAdmin = await User.findById(admin._id);
    console.log('✅ Verified in database:', savedAdmin.email);
    
    console.log('🔵 Cleaning up test data...');
    await User.findByIdAndDelete(admin._id);
    console.log('✅ Test cleanup complete');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
  }
}

testAdminCreation();
