const express = require('express');
const router = express.Router();
const requestController = require('../controllers/requestController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Blood Requests
router.post('/', authenticateToken, requestController.createRequest);
router.get('/', requestController.getRequests);
router.get('/:id', requestController.getRequestById);
router.put('/:id', authenticateToken, requestController.updateRequestStatus);
router.post('/:id/trigger-donor-fallback', authenticateToken, requestController.triggerDonorFallback);

// Donation Requests (Direct donor targeting & response)
router.post('/donation-request', authenticateToken, requestController.sendDonationRequest);
router.put('/donation-request/:id/respond', authenticateToken, requestController.respondDonationRequest);
router.get('/donor/my-requests', authenticateToken, requestController.getDonorDonationRequests);

module.exports = router;
