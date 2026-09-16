// Application Configuration
// Edit this file to customize your booking system settings

export const config = {
  // Business Information
  businessName: 'EducatOrr',
  businessDescription: 'Schedule your tutoring session in just a few steps',

  // General Booking Settings
  booking: {
    // How many days in advance can clients book?
    advanceBookingDays: 90,

    // Allow booking on weekends? (Can be overridden per school)
    allowWeekends: false,
  },

  // Phone Call Configuration (15-minute check-in, no drive time or buffer)
  phoneCall: {
    enabled: true,
    sessionDuration: 15,
    availability: {
      0: [], // Sunday
      1: [{ start: '09:00', end: '17:00' }],
      2: [{ start: '09:00', end: '17:00' }],
      3: [{ start: '09:00', end: '17:00' }],
      4: [{ start: '09:00', end: '17:00' }],
      5: [{ start: '09:00', end: '17:00' }],
      6: [] // Saturday
    }
  },

  // Google Meet Configuration
  googleMeet: {
    enabled: true,
    sessionDuration: 60, // Default session duration for Google Meet (in minutes)

    // Available time blocks for Google Meet sessions
    // These apply to all days unless specified per day
    availability: {
      0: [], // Sunday - not available
      1: [{ start: '09:00', end: '17:00' }], // Monday
      2: [{ start: '09:00', end: '17:00' }], // Tuesday
      3: [{ start: '09:00', end: '17:00' }], // Wednesday
      4: [{ start: '09:00', end: '17:00' }], // Thursday
      5: [{ start: '09:00', end: '17:00' }], // Friday
      6: [] // Saturday - not available
    }
  },

  // Location Options
  locationOptions: {
    // Allow clients to enter a custom location
    allowCustomLocation: true,

    // Custom location default session duration (in minutes)
    customLocationSessionDuration: 60,

    // Placeholder text for custom location input
    customLocationPlaceholder: 'Enter your preferred meeting location...',

    // Help text for custom location
    customLocationHelp: 'Please provide a specific address or location name',

    // Custom location availability (same format as schools)
    customLocationAvailability: {
      1: [{ start: '09:00', end: '17:00' }],
      2: [{ start: '09:00', end: '17:00' }],
      3: [{ start: '09:00', end: '17:00' }],
      4: [{ start: '09:00', end: '17:00' }],
      5: [{ start: '09:00', end: '17:00' }]
    }
  },

  // Meeting Types Available
  meetingTypes: {
    phoneCall: {
      enabled: true,
      label: 'Phone Call',
      description: 'Quick 15-minute call to discuss your needs.',
      icon: '📞'
    },
    googleMeet: {
      enabled: true,
      label: 'Google Meet',
      description: 'Join remotely via video call. A Google Meet link will be generated and sent to you.',
      icon: '📹'
    },
    physical: {
      enabled: true,
      label: 'School Location',
      description: 'Meet in person at one of the schools.',
      icon: '🏫'
    }
  }
}

export default config
