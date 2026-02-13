import nodemailer from 'nodemailer'
import otpGenerator from 'otp-generator'

class EmailService {
  constructor() {
    this.useBrevo = Boolean(process.env.BREVO_API_KEY)

    if (this.useBrevo) {
      this.brevoApiKey = process.env.BREVO_API_KEY
      this.senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.SMTP_FROM
      this.senderName = process.env.BREVO_SENDER_NAME || 'Clean Street'

      if (!this.senderEmail) {
        console.warn('  Brevo enabled but sender email is missing')
      }
      return
    }

    // Only initialize if SMTP credentials are provided
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        }
      })
      
      // Test connection
      this.transporter.verify((error, success) => {
        if (error) {
          console.warn('⚠️  Email service not available:', error.message)
          this.transporter = null
        } else if (success) {
          console.log('✅ Email service connected successfully')
        }
      })
    } else {
      console.warn('⚠️  Email service disabled - SMTP credentials not configured')
      this.transporter = null
    }
  }

  // Send email
  async sendEmail(to, subject, html) {
    try {
      if (this.useBrevo) {
        return await this.sendBrevoEmail(to, subject, html)
      }

      // If email service is disabled, log and fail
      if (!this.transporter) {
        console.warn('⚠️  Email skipped (service disabled):', to, subject)
        return { success: false, error: 'Email service disabled' }
      }

      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        html
      })
      console.log('📧 Email sent to:', to)
      return { success: true }
    } catch (error) {
      console.error('❌ Email sending failed:', error.message)
      return { success: false, error: error.message }
    }
  }

  async sendBrevoEmail(to, subject, html) {
    try {
      if (!this.brevoApiKey || !this.senderEmail) {
        console.warn('⚠️  Brevo email skipped (missing config):', to, subject)
        return { success: false, error: 'Brevo config missing' }
      }

      console.log('📨 Brevo sender:', this.senderEmail, '-', this.senderName)

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': this.brevoApiKey
        },
        body: JSON.stringify({
          sender: {
            email: this.senderEmail,
            name: this.senderName
          },
          to: [{ email: to }],
          subject,
          htmlContent: html
        })
      })

      const responseText = await response.text()

      if (!response.ok) {
        throw new Error(`Brevo API error: ${response.status} ${responseText}`)
      }

      let messageId
      try {
        const parsed = responseText ? JSON.parse(responseText) : null
        messageId = parsed?.messageId
      } catch {
        messageId = undefined
      }

      if (messageId) {
        console.log('📧 Brevo email sent to:', to, 'messageId:', messageId)
      } else {
        console.log('📧 Brevo email sent to:', to)
      }

      return { success: true, messageId }
    } catch (error) {
      console.error('❌ Brevo email sending failed:', error.message)
      return { success: false, error: error.message }
    }
  }

  // Generate OTP
  generateOTP(length = 6) {
    return otpGenerator.generate(length, {
      digits: true,
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false
    })
  }

  // Send password reset OTP
  async sendPasswordResetOTP(email, otp) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Password Reset Request</h2>
        <p>You requested to reset your password. Use the OTP below to proceed:</p>
        <div style="background: #f4f4f4; padding: 15px; text-align: center; margin: 20px 0; border-radius: 5px;">
          <h1 style="margin: 0; color: #1976d2; letter-spacing: 5px;">${otp}</h1>
        </div>
        <p>This OTP will expire in <strong>15 minutes</strong>.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">Clean Street Platform</p>
      </div>
    `

    return this.sendEmail(
      email,
      'Clean Street - Password Reset OTP',
      html
    )
  }

  // Send password changed confirmation
  async sendPasswordChangedConfirmation(email) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Password Changed Successfully</h2>
        <p>Your password has been reset successfully.</p>
        <p>If you did not make this change, please contact our support immediately.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">Clean Street Platform</p>
      </div>
    `

    return this.sendEmail(
      email,
      'Clean Street - Password Changed Successfully',
      html
    )
  }

  // Send verification OTP
  async sendVerificationOTP(email, otp) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Verify Your Email Address</h2>
        <p>Thank you for registering! Use the OTP below to verify your email:</p>
        <div style="background: #f4f4f4; padding: 15px; text-align: center; margin: 20px 0; border-radius: 5px;">
          <h1 style="margin: 0; color: #1976d2; letter-spacing: 5px;">${otp}</h1>
        </div>
        <p>This OTP will expire in <strong>15 minutes</strong>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">Clean Street Platform</p>
      </div>
    `

    return this.sendEmail(
      email,
      'Clean Street - Verify Your Email',
      html
    )
  }

  // Send welcome email
  async sendWelcomeEmail(email, name) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to Clean Street!</h2>
        <p>Hi ${name},</p>
        <p>Thank you for joining Clean Street. Your account has been created successfully.</p>
        <p>You can now start reporting issues and contributing to a cleaner environment.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">Clean Street Platform</p>
      </div>
    `

    return this.sendEmail(
      email,
      'Welcome to Clean Street!',
      html
    )
  }
}

export default new EmailService()