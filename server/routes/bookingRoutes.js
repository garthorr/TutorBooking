import express from 'express'
import dbService from '../services/dbService.js'

const router = express.Router()

router.get('/config', (req, res) => {
  const admin = dbService.getAdminUser()
  const settings = dbService.getSettings(admin.id)
  res.json({
    googleMeetDuration: settings.google_meet_duration,
    customLocationDuration: settings.custom_location_duration,
    theme_color: settings.theme_color,
    businessName: settings.business_name,
    businessDescription: settings.business_description
  })
})

export default router
