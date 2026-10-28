const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// Statistics is public / accessible for homepage and admin
router.get('/statistics', adminController.getStatistics);

// Admin-only endpoints
router.use(authenticateToken, requireRole(['Admin']));

router.get('/users', adminController.getUsers);
router.put('/users/:id/status', adminController.toggleUserStatus);
router.get('/donors', adminController.getDonors);
router.get('/hospitals', adminController.getHospitals);
router.get('/requests', adminController.getRequests);

module.exports = router;
