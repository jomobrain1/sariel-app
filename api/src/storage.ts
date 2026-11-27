import { createCloudinaryStorage } from '@tilcayo/cloudinary';

export const storage = createCloudinaryStorage({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.CLOUDINARY_API_SECRET_KEY || process.env.CLOUDINARY_API_SECRET,
  profiles: {
    avatar: { resourceType: 'image', deliveryType: 'upload', allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 2 * 1024 * 1024, folder: 'tilcayo/avatars' },
    productImage: { resourceType: 'image', deliveryType: 'upload', allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 5 * 1024 * 1024, folder: 'tilcayo/products' },
    document: { resourceType: 'raw', deliveryType: 'authenticated', allowedExtensions: ['pdf', 'docx', 'xlsx', 'zip'], maxBytes: 20 * 1024 * 1024, folder: 'tilcayo/documents' },
    // Public "someone is in danger" reports: private files, viewable only through short-lived signed links.
    publicReportImage: { resourceType: 'image', deliveryType: 'authenticated', allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'heic'], maxBytes: 10 * 1024 * 1024, folder: 'sariel/public-reports' },
    publicReportVideo: { resourceType: 'video', deliveryType: 'authenticated', allowedExtensions: ['mp4', 'mov', 'webm', '3gp'], maxBytes: 50 * 1024 * 1024, folder: 'sariel/public-reports' },
  },
});

export const storageConfigured = () => !!(process.env.CLOUDINARY_CLOUD_NAME?.trim() && process.env.CLOUDINARY_API_KEY?.trim()
  && (process.env.CLOUDINARY_API_SECRET_KEY || process.env.CLOUDINARY_API_SECRET)?.trim());
