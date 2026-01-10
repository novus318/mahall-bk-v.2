import express from 'express';
import {
    createBuilding,
    getBuildings,
    updateBuilding,
    deleteBuilding,
    createRoom,
    getRooms,
    updateRoom,
    deleteRoom
} from '../controllers/buildingController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/')
    .post(protect, createBuilding)
    .get(protect, getBuildings);

router.route('/:id')
    .put(protect, updateBuilding)
    .delete(protect, deleteBuilding);

router.route('/:id/rooms')
    .post(protect, createRoom)
    .get(protect, getRooms);

// Routes for individual rooms (using /buildings/rooms/:id or just /rooms/:id)
// Let's use a specific path for room operations to avoid conflict, or just mount a separate router?
// Or we can add specific routes here. Since /:id usually matches building ID, 
// let's put clean room routes under a different path or just be specific.
// However, the cleanest way in this specific file structure without new global route:
router.route('/rooms/:id')
    .put(protect, updateRoom)
    .delete(protect, deleteRoom);

export default router;
