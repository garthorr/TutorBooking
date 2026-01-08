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

  // Schools/Physical Locations Configuration
  // Each school can have different session lengths and availability schedules
  schools: [
    {
      id: 'elementary-school',
      name: 'Lincoln Elementary School',
      address: '123 Main St, Springfield',
      sessionDuration: 30, // 30 minute sessions

      // Available time blocks for this school
      // Day of week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      availability: {
        1: [ // Monday
          { start: '08:00', end: '12:00' },
          { start: '13:00', end: '15:30' }
        ],
        2: [ // Tuesday
          { start: '08:00', end: '12:00' },
          { start: '13:00', end: '15:30' }
        ],
        3: [ // Wednesday
          { start: '08:00', end: '12:00' }
        ],
        4: [ // Thursday
          { start: '08:00', end: '12:00' },
          { start: '13:00', end: '15:30' }
        ],
        5: [ // Friday
          { start: '08:00', end: '12:00' },
          { start: '13:00', end: '15:30' }
        ]
      }
    },
    {
      id: 'middle-school',
      name: 'Washington Middle School',
      address: '456 Oak Ave, Springfield',
      sessionDuration: 45, // 45 minute sessions

      availability: {
        1: [ // Monday
          { start: '14:00', end: '17:00' }
        ],
        2: [ // Tuesday
          { start: '14:00', end: '17:00' }
        ],
        3: [ // Wednesday
          { start: '14:00', end: '16:00' }
        ],
        4: [ // Thursday
          { start: '14:00', end: '17:00' }
        ],
        5: [ // Friday
          { start: '14:00', end: '16:30' }
        ]
      }
    },
    {
      id: 'high-school',
      name: 'Jefferson High School',
      address: '789 Elm Street, Springfield',
      sessionDuration: 60, // 60 minute sessions

      availability: {
        1: [ // Monday
          { start: '15:30', end: '18:00' }
        ],
        2: [ // Tuesday
          { start: '15:30', end: '18:00' }
        ],
        3: [ // Wednesday
          { start: '15:30', end: '18:00' }
        ],
        4: [ // Thursday
          { start: '15:30', end: '18:00' }
        ],
        5: [ // Friday
          { start: '14:00', end: '17:00' }
        ]
      }
    },
    {
      id: 'community-center',
      name: 'Community Learning Center',
      address: '321 Park Road, Springfield',
      sessionDuration: 60, // 60 minute sessions

      // Flexible availability - including weekends
      availability: {
        1: [{ start: '09:00', end: '17:00' }], // Monday
        2: [{ start: '09:00', end: '17:00' }], // Tuesday
        3: [{ start: '09:00', end: '17:00' }], // Wednesday
        4: [{ start: '09:00', end: '17:00' }], // Thursday
        5: [{ start: '09:00', end: '17:00' }], // Friday
        6: [{ start: '10:00', end: '15:00' }]  // Saturday
      }
    }
  ],

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
