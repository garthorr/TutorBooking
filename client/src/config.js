// Application Configuration
// Edit this file to customize your booking system settings

export const config = {
  // Business Information
  businessName: 'Tutoring Services',
  businessDescription: 'Schedule your tutoring session in just a few steps',

  // Booking Settings
  booking: {
    // Available hours (24-hour format)
    startHour: 9,  // 9 AM
    endHour: 17,   // 5 PM

    // Session duration in minutes
    sessionDuration: 60,

    // How many days in advance can clients book?
    advanceBookingDays: 90,

    // Allow booking on weekends?
    allowWeekends: false,
  },

  // Physical Meeting Locations
  // Add, remove, or modify locations as needed
  physicalLocations: [
    'Main Office - 123 Main St, Suite 100',
    'Downtown Branch - 456 Center Ave',
    'University Campus - Building A, Room 201',
    'Community Center - 789 Park Road'
  ],

  // Location Options
  locationOptions: {
    // Allow clients to enter a custom location
    allowCustomLocation: true,

    // Placeholder text for custom location input
    customLocationPlaceholder: 'Enter your preferred meeting location...',

    // Help text for custom location
    customLocationHelp: 'Please provide a specific address or location name'
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
      label: 'Physical Location',
      description: 'Meet in person at a location of your choice.',
      icon: '📍'
    }
  }
}

export default config
