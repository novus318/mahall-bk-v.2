import express from 'express';
import { getFamilies, createFamily } from '../controllers/familyController.js';
import { getHouses, createHouse } from '../controllers/houseController.js';
import { getMembers, createMember } from '../controllers/memberController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply protect middleware to all routes
router.use(protect);

router.route('/families').get(getFamilies).post(authorize('admin', 'staff'), createFamily);
router.route('/houses').get(getHouses).post(authorize('admin', 'staff'), createHouse);
router.route('/members').get(getMembers).post(authorize('admin', 'staff', 'data-entry'), createMember);

export default router;
