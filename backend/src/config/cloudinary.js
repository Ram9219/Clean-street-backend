import cloudinary from 'cloudinary'

const uploadConfig = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    console.warn('Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET')
    return
  }

  cloudinary.v2.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret
  })
}

export const uploadImage = async (fileBuffer, fileName) => {
  try {
    uploadConfig()
    
    return new Promise((resolve, reject) => {
      if (!cloudinary.v2.config().cloud_name) {
        return reject(new Error('Cloudinary is not configured'))
      }
      const uploadStream = cloudinary.v2.uploader.upload_stream(
        {
          resource_type: 'auto',
          public_id: `clean_street/${fileName}`,
          folder: 'clean_street/reports',
          overwrite: true,
          quality: 'auto:best',
          fetch_format: 'auto'
        },
        (error, result) => {
          if (error) reject(error)
          else resolve(result)
        }
      )

      uploadStream.end(fileBuffer)
    })
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

export const uploadProfileImage = async (fileBuffer, fileName) => {
  try {
    uploadConfig()

    return new Promise((resolve, reject) => {
      if (!cloudinary.v2.config().cloud_name) {
        return reject(new Error('Cloudinary is not configured'))
      }
      const uploadStream = cloudinary.v2.uploader.upload_stream(
        {
          resource_type: 'auto',
          public_id: fileName,
          folder: 'clean_street/profiles',
          overwrite: true,
          quality: 'auto:best',
          fetch_format: 'auto'
        },
        (error, result) => {
          if (error) reject(error)
          else resolve(result)
        }
      )

      uploadStream.end(fileBuffer)
    })
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    throw error
  }
}

export const deleteImage = async (publicId) => {
  try {
    uploadConfig()
    
    return new Promise((resolve, reject) => {
      if (!cloudinary.v2.config().cloud_name) {
        return reject(new Error('Cloudinary is not configured'))
      }
      cloudinary.v2.uploader.destroy(publicId, (error, result) => {
        if (error) reject(error)
        else resolve(result)
      })
    })
  } catch (error) {
    console.error('Cloudinary delete error:', error)
    throw error
  }
}

export default uploadConfig
