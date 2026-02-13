import dotenv from 'dotenv'

// Load environment variables FIRST - must be before other imports that use env vars
dotenv.config()

import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import MongoStore from 'connect-mongo'
import passport from 'passport'
import connectDB from './config/database.js'
import { apiLimiter } from './middleware/rateLimiter.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()

// Dynamically import routes AFTER env vars are loaded
let authRoutes, adminRoutes, User, createSuperAdmin;

// Use async function to handle dynamic imports properly
const initializeApp = async () => {
  try {
    // Import modules
    authRoutes = (await import('./routes/auth.js')).default;
    adminRoutes = (await import('./routes/admin.js')).default;
    User = (await import('./models/User.js')).default;
    
    // Admin setup utility - adjust path if needed
    createSuperAdmin = (await import('../scripts/create-super-admin.js')).default;

    // Connect to MongoDB
    await connectDB();

    // Trust proxy so req.ip works correctly (needed for rate limiting behind proxy)
    app.set('trust proxy', 1);

    // Middleware
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));
    
    // Build allowed origins with fallbacks
    const frontendUrl = process.env.FRONTEND_URL || 'https://infosys.ramkumar.app'
    const adminUrl = process.env.ADMIN_FRONTEND_URL || 'https://infosys.ramkumar.app/admin'
    const cookieDomain = process.env.COOKIE_DOMAIN || '.ramkumar.app'

    const allowedOrigins = [
      frontendUrl,
      adminUrl,
      'https://infosys.ramkumar.app',
      'https://admin.infosys.ramkumar.app',
      'http://localhost:3001',
      'http://localhost:3000',
      'http://admin.localhost:3000'
    ].filter(Boolean);

    console.log('🔒 CORS allowed origins:', allowedOrigins)
    console.log('🍪 Session cookie domain:', cookieDomain)

    app.use(cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isAllowed = allowedOrigins.includes(origin) || /^http:\/\/.*\.localhost:3000$/.test(origin);
        if (isAllowed) {
          callback(null, true);
        } else {
          console.warn('❌ CORS rejected origin:', origin);
          callback(new Error('CORS not allowed'));
        }
      },
      credentials: true,
      exposedHeaders: ['Content-Disposition']
    }));
    
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    app.use(morgan('dev'));
    app.use(cookieParser());

    // Global API rate limiter
    app.use('/api/', apiLimiter);

    // Disable caching for API endpoints to prevent 304 responses
    app.use('/api/', (req, res, next) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      next();
    });

    // Session configuration
    app.use(session({
      secret: process.env.SESSION_SECRET || 'clean-street-session-secret-2024',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/clean_street',
        collectionName: 'sessions',
        ttl: 24 * 60 * 60 // 24 hours
      }),
      cookie: {
        secure: true,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'none', // Required for cross-domain cookies
        domain: cookieDomain,
        path: '/'
      },
      name: 'clean_street.sid'
    }));

    // Initialize Passport
    app.use(passport.initialize());
    app.use(passport.session());

    // Configure passport (you need to add this)
    import('./config/passport.js').then(passportConfig => {
      // Passport configuration should be done in that file
    });

    // Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/admin', adminRoutes);
    
    // Import and use reports routes
    const reportsRoutes = (await import('./routes/reports.js')).default;
    app.use('/api/reports', reportsRoutes);

    // Import and use volunteer routes
    const volunteerRoutes = (await import('./routes/volunteers.js')).default;
    app.use('/api/volunteers', volunteerRoutes);

    // Import and use setup routes
    const setupRoutes = (await import('./routes/setup.js')).default;
    app.use('/api/setup', setupRoutes);

    // Import and use notification routes
    const notificationRoutes = (await import('./routes/notifications.js')).default;
    app.use('/api/notifications', notificationRoutes);

    // Admin setup endpoint (only available in development or with special key)
    app.post('/api/setup/super-admin', async (req, res) => {
      // Only allow in development mode or with master key
      const masterKey = req.headers['x-master-key'];
      
      if (process.env.NODE_ENV !== 'development' && masterKey !== process.env.MASTER_SETUP_KEY) {
        return res.status(403).json({
          success: false,
          error: 'Super admin setup not allowed in production without master key'
        });
      }
      
      try {
        const { email, password, name } = req.body;
        
        if (!email || !password || !name) {
          return res.status(400).json({
            success: false,
            error: 'Email, password, and name are required'
          });
        }
        
        // Create super admin
        const result = await createSuperAdmin({ email, password, name });
        
        if (result.success) {
          res.status(201).json(result);
        } else {
          res.status(400).json(result);
        }
      } catch (error) {
        console.error('Super admin setup error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to create super admin'
        });
      }
    });

    // System status endpoint
    app.get('/api/system/status', async (req, res) => {
      try {
        const superAdminCount = await User.countDocuments({ isSuperAdmin: true });
        const adminCount = await User.countDocuments({ role: 'admin', isSuperAdmin: false });
        const totalUsers = await User.countDocuments();
        
        res.json({
          success: true,
          system: {
            name: 'Clean Street Platform',
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV,
            database: 'connected',
            superAdmins: superAdminCount,
            admins: adminCount,
            totalUsers,
            setupRequired: superAdminCount === 0
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get system status'
        });
      }
    });

    // Health check
    app.get('/api/health', (req, res) => {
      res.json({ 
        success: true,
        status: 'OK', 
        message: 'Clean Street API is running',
        session: req.sessionID ? 'active' : 'none',
        user: req.user ? 'authenticated' : 'guest',
        timestamp: new Date().toISOString()
      });
    });

    // Serve setup wizard if no super admin exists
    app.get('/setup', async (req, res) => {
      try {
        const superAdminCount = await User.countDocuments({ isSuperAdmin: true });
        
        if (superAdminCount > 0) {
          // Redirect to admin login if already set up
          return res.redirect('/admin/login');
        }
        
        // Serve setup wizard HTML
        res.sendFile(path.join(__dirname, 'public', 'setup.html'));
      } catch (error) {
        res.status(500).send('Setup check failed');
      }
    });

    // Protect admin routes until setup is complete
    app.use('/api/admin/*', async (req, res, next) => {
      try {
        const superAdminCount = await User.countDocuments({ isSuperAdmin: true });
        
        if (superAdminCount === 0 && !req.path.includes('/setup')) {
          return res.status(503).json({
            success: false,
            error: 'System setup required',
            setupUrl: '/setup'
          });
        }
        
        next();
      } catch (error) {
        next(error);
      }
    });

    // 404 handler
    app.use('/api/*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'API endpoint not found'
      });
    });

    // Error handling
    app.use((err, req, res, next) => {
      console.error(err.stack);
      
      // Handle specific errors
      if (err.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          details: err.errors
        });
      }
      
      if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }
      
      res.status(500).json({ 
        success: false,
        error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!'
      });
    });

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
};

// Start the application
initializeApp();