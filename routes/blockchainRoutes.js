const express = require('express');
const router = express.Router();
const { authenticate, authorizeAction } = require('../middleware/auth');
const blockchainController = require('../controllers/blockchainController');

router.get('/', authenticate, authorizeAction('viewBlockchain'), blockchainController.getBlocks);
router.post('/validate', authenticate, authorizeAction('validateBlockchain'), blockchainController.validateBlockchain);

module.exports = router;
