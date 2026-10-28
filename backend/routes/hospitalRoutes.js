const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const donorController = require('../controllers/donorController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

// Hospital specific dashboard routes
router.use(authenticateToken, requireRole(['Hospital', 'Admin']));

router.post('/requests', requestController.createRequest);
router.get('/requests', requestController.getRequests);
router.get('/donors', donorController.searchDonors);

module.exports = router;
