// School Configuration and Drive Time Matrix
// This file defines the drive times between different school locations

export const schoolConfig = {
  // Drive times between schools in minutes (actual driving time)
  // 5 minutes for walking/parking will be added automatically
  // Times will be rounded to nearest 5 minutes
  driveTimes: {
    'elementary-school': {
      'middle-school': 15,    // 15 min drive
      'high-school': 20,      // 20 min drive
      'community-center': 10  // 10 min drive
    },
    'middle-school': {
      'elementary-school': 15,
      'high-school': 12,
      'community-center': 18
    },
    'high-school': {
      'elementary-school': 20,
      'middle-school': 12,
      'community-center': 25
    },
    'community-center': {
      'elementary-school': 10,
      'middle-school': 18,
      'high-school': 25
    }
  }
}

// Helper function to get drive time between two schools
export function getDriveTime(fromSchoolId, toSchoolId) {
  // Same school = no drive time
  if (fromSchoolId === toSchoolId) {
    return 0
  }

  // No schoolId means Google Meet - no drive time
  if (!fromSchoolId || !toSchoolId) {
    return 0
  }

  // Look up drive time
  const driveTime = schoolConfig.driveTimes[fromSchoolId]?.[toSchoolId]

  if (driveTime === undefined) {
    console.warn(`⚠️  No drive time defined between ${fromSchoolId} and ${toSchoolId}, using default 30 minutes`)
    return 30
  }

  // Add 5 minutes for walking/parking
  const totalTime = driveTime + 5

  // Round to nearest 5 minutes
  return Math.round(totalTime / 5) * 5
}

export default schoolConfig
