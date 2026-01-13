import express from 'express';
import multer from 'multer';
import { getFamilies, getFamilyById, createFamily, updateFamily, deleteFamily, bulkImportFamilies } from '../controllers/familyController.js';
import { getHouses, getHouseById, createHouse, updateHouse, deleteHouse, bulkImportHouses } from '../controllers/houseController.js';
import { getMembers, getMemberById, createMember, updateMember, deleteMember, bulkImportMembers, moveOutMember } from '../controllers/memberController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Apply protect middleware to all routes
router.use(protect);

router.route('/families').get(getFamilies).post(authorize('admin', 'staff'), createFamily);
router.route('/families/import').post(authorize('admin', 'staff'), upload.single('file'), bulkImportFamilies);
router.route('/families/:id').get(getFamilyById).put(authorize('admin', 'staff'), updateFamily).delete(authorize('admin'), deleteFamily);

router.route('/houses').get(getHouses).post(authorize('admin', 'staff'), createHouse);
router.route('/houses/import').post(authorize('admin', 'staff'), upload.single('file'), bulkImportHouses);
router.route('/houses/:id').get(getHouseById).put(authorize('admin', 'staff'), updateHouse).delete(authorize('admin'), deleteHouse);

router.route('/members').get(getMembers).post(authorize('admin', 'staff', 'data-entry'), createMember);
router.route('/members/import').post(authorize('admin', 'staff'), upload.single('file'), bulkImportMembers);
router.route('/members/:id').get(authorize('admin', 'staff'), getMemberById).put(authorize('admin', 'staff'), updateMember).delete(authorize('admin'), deleteMember);
router.route('/members/:id/move-out').put(authorize('admin', 'staff'), moveOutMember);

export default router;
