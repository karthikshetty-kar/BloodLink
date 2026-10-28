const express = require('express');
const router = express.Router();
const donorController = require('../controllers/donorController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/search', donorController.searchDonors);
router.get('/match', donorController.getMatchingDonorsForRequest);
router.get('/', donorController.searchDonors);
router.get('/:id', donorController.getDonorById);
router.put('/profile', authenticateToken, donorController.updateDonorProfile);

module.exports = router;
