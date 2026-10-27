const path = require('path');
module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  UPLOADS_DIR: path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads'),
  MAX_BODY: 25 * 1024 * 1024,
  MAX_PHOTOS: 3,
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: new Set(['image/jpeg', 'image/png', 'image/webp']),
  STATUSES: ['Submitted', 'Assigned', 'In Progress', 'Resolved', 'Closed'],
  // Routing, priority and SLA hours: configurable DEMONSTRATION values, not official policy.
  CATEGORIES: {
    'Roads and Potholes': { department: 'Roads and Infrastructure', priority: 'High', slaHours: 72 },
    'Water Supply': { department: 'Water Supply Department', priority: 'High', slaHours: 24 },
    'Garbage and Sanitation': { department: 'Sanitation Department', priority: 'Medium', slaHours: 48 },
    'Drainage': { department: 'Drainage Department', priority: 'High', slaHours: 48 },
    'Streetlights': { department: 'Electrical Maintenance Department', priority: 'Medium', slaHours: 72 }
  }
};
