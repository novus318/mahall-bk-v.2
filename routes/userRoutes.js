import express from 'express';
import {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    resetUserPassword,
    getUserProfile,
    updateProfile,
    changePassword
} from '../controllers/userController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

// Profile routes (Any authenticated user)
router.route('/profile')
    .get(getUserProfile)
    .put(updateProfile);
router.route('/profile/password').put(changePassword);

// Admin routes
router.route('/')
    .get(authorize('admin'), getUsers)
    .post(authorize('admin'), createUser);

router.route('/:id')
    .put(authorize('admin'), updateUser)
    .delete(authorize('admin'), deleteUser);

router.route('/:id/reset-password')
    .put(authorize('admin'), resetUserPassword);

export default router;
