import Building from '../models/Building.js';
import Room from '../models/Room.js';

// @desc    Create a new building
// @route   POST /api/buildings
// @access  Private
const createBuilding = async (req, res) => {
    try {
        const { buildingId, name, place } = req.body;

        const buildingExists = await Building.findOne({ buildingId: buildingId.toUpperCase() });
        if (buildingExists) {
            return res.status(400).json({ message: 'Building ID already exists' });
        }

        const building = await Building.create({
            buildingId: buildingId.toUpperCase(),
            name,
            place
        });

        res.status(201).json(building);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get all buildings
// @route   GET /api/buildings
// @access  Private
const getBuildings = async (req, res) => {
    try {
        const buildings = await Building.find({}).populate('rooms');
        res.json(buildings);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update a building
// @route   PUT /api/buildings/:id
// @access  Private
const updateBuilding = async (req, res) => {
    try {
        const { name, place } = req.body;
        const building = await Building.findById(req.params.id);

        if (building) {
            building.name = name || building.name;
            building.place = place || building.place;

            const updatedBuilding = await building.save();
            res.json(updatedBuilding);
        } else {
            res.status(404).json({ message: 'Building not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete a building
// @route   DELETE /api/buildings/:id
// @access  Private
const deleteBuilding = async (req, res) => {
    try {
        const building = await Building.findById(req.params.id);

        if (building) {
            // Check if building has active contracts or rooms?
            // For now, allow delete but clean up rooms
            await Room.deleteMany({ building: req.params.id });
            await building.deleteOne();
            res.json({ message: 'Building removed' });
        } else {
            res.status(404).json({ message: 'Building not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a room in a building
// @route   POST /api/buildings/:id/rooms
// @access  Private
const createRoom = async (req, res) => {
    try {
        const { roomNumber } = req.body; // Removed 'status', default is VACANT
        const buildingId = req.params.id;

        const building = await Building.findById(buildingId);
        if (!building) {
            return res.status(404).json({ message: 'Building not found' });
        }

        const roomExists = await Room.findOne({ building: buildingId, roomNumber });
        if (roomExists) {
            return res.status(400).json({ message: 'Room number already exists in this building' });
        }

        const room = await Room.create({
            roomNumber,
            building: buildingId,
            status: 'VACANT'
        });

        res.status(201).json(room);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get rooms for a building
// @route   GET /api/buildings/:id/rooms
// @access  Private
const getRooms = async (req, res) => {
    try {
        const rooms = await Room.find({ building: req.params.id }).populate('currentContract');
        res.json(rooms);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update a room
// @route   PUT /api/rooms/:id
// @access  Private
const updateRoom = async (req, res) => {
    try {
        const { roomNumber } = req.body;
        const room = await Room.findById(req.params.id);

        if (room) {
            // Check uniqueness if number changed
            if (roomNumber && roomNumber !== room.roomNumber) {
                const roomExists = await Room.findOne({ building: room.building, roomNumber });
                if (roomExists) {
                    return res.status(400).json({ message: 'Room number already exists' });
                }
            }

            room.roomNumber = roomNumber || room.roomNumber;
            // Status updates should generally happen via contracts, but allowing here if needed?
            // For now just roomNumber for "Edit" context

            const updatedRoom = await room.save();
            res.json(updatedRoom);
        } else {
            res.status(404).json({ message: 'Room not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete a room
// @route   DELETE /api/rooms/:id
// @access  Private
const deleteRoom = async (req, res) => {
    try {
        const room = await Room.findById(req.params.id);

        if (room) {
            // Block if occupied?
            if (room.status === 'OCCUPIED') {
                return res.status(400).json({ message: 'Cannot delete an occupied room' });
            }
            await room.deleteOne();
            res.json({ message: 'Room removed' });
        } else {
            res.status(404).json({ message: 'Room not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export {
    createBuilding,
    getBuildings,
    updateBuilding,
    deleteBuilding,
    createRoom,
    getRooms,
    updateRoom,
    deleteRoom
};
