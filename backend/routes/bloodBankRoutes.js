const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const bloodBankController = require('../controllers/bloodBankController');

// All routes require authentication and Blood Bank role
const protect = [authenticateToken, requireRole(['Blood Bank'])];

// Blood Bank Profile & Stats
router.get('/profile', protect, bloodBankController.getProfile);
router.get('/dashboard-stats', protect, bloodBankController.getDashboardStats);

// Inventory Management
router.put('/inventory', protect, bloodBankController.updateInventory);

// Request Management
router.get('/assigned-requests', protect, bloodBankController.getAssignedRequests);
router.post('/respond/:requestId', protect, bloodBankController.respondToRequest);

// Public: Get all banks (used for routing and map display)
router.get('/all', authenticateToken, bloodBankController.getAllBanks);

module.exports = router;
