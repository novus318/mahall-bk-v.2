import House from '../models/House.js';
import Family from '../models/Family.js';

// @desc    Get all houses
// @route   GET /api/houses
// @access  Public
const getHouses = async (req, res) => {
    try {
        const houses = await House.find({}).populate('family', 'name customId');
        res.json(houses);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a new house
// @route   POST /api/houses
// @access  Public
const createHouse = async (req, res) => {
    try {
        const { name, address, familyId } = req.body;

        let familyPrefix;
        let searchQuery = {};

        if (familyId) {
            const family = await Family.findById(familyId);
            if (!family) {
                return res.status(404).json({ message: 'Family not found' });
            }
            familyPrefix = family.customId;
            searchQuery.family = familyId;
        } else {
            familyPrefix = 'IND';
            searchQuery.family = { $exists: false };
        }

        // Logic to generate House ID: CYS001 or IND001
        // Find the last house created for this family (or independent) to determine ID
        const lastHouse = await House.findOne(searchQuery).sort({ createdAt: -1 });

        let nextSeq = 1;
        if (lastHouse) {
            // Extract sequence from last ID: CYS001 -> 001
            const lastSeqStr = lastHouse.customId.substring(3); // Remove first 3 chars (Family ID)
            const lastSeq = parseInt(lastSeqStr, 10);
            if (!isNaN(lastSeq)) {
                nextSeq = lastSeq + 1;
            }
        }

        // Pad with zeros to 3 digits
        const seqStr = nextSeq.toString().padStart(3, '0');
        const houseCustomId = `${familyPrefix}${seqStr}`;

        const houseData = {
            name,
            customId: houseCustomId,
            address,
        };

        if (familyId) {
            houseData.family = familyId;
        }

        const house = await House.create(houseData);

        res.status(201).json(house);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

export { getHouses, createHouse };
