import Member from '../models/Member.js';
import House from '../models/House.js';

// @desc    Get all members
// @route   GET /api/members
// @access  Public
const getMembers = async (req, res) => {
    try {
        const members = await Member.find({})
            .populate('house', 'name customId')
            .populate('family', 'name customId');
        res.json(members);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a new member
// @route   POST /api/members
// @access  Public
const createMember = async (req, res) => {
    try {
        const {
            name,
            gender,
            dateOfBirth,
            mobile,
            whatsapp,
            bloodGroup,
            education,
            madrassa,
            maritalStatus,
            occupation,
            place,
            idCards,
            houseId,
            parents, // Array of Member IDs
            spouse,
            children
        } = req.body;

        const house = await House.findById(houseId).populate('family');

        if (!house) {
            return res.status(404).json({ message: 'House not found' });
        }

        // Logic to generate Member ID: CYS00101 or IND00101
        // Find the last member created for this house
        const lastMember = await Member.findOne({ house: houseId }).sort({ createdAt: -1 });

        let nextSeq = 1;
        if (lastMember) {
            // Extract sequence from last ID: CYS00101 -> 01
            const lastSeqStr = lastMember.customId.substring(6); // Remove first 6 chars (House ID)
            const lastSeq = parseInt(lastSeqStr, 10);
            if (!isNaN(lastSeq)) {
                nextSeq = lastSeq + 1;
            }
        }

        // Pad with zeros to 2 digits
        const seqStr = nextSeq.toString().padStart(2, '0');
        const memberCustomId = `${house.customId}${seqStr}`;

        const memberData = {
            name,
            customId: memberCustomId,
            gender,
            dateOfBirth,
            mobile,
            whatsapp,
            bloodGroup,
            education,
            madrassa,
            maritalStatus,
            occupation,
            place,
            idCards,
            house: houseId,
            parents,
            spouse,
            children
        };

        const member = new Member(memberData);

        if (house.family) {
            member.family = house.family._id;
        }

        await member.save();

        res.status(201).json(member);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

export { getMembers, createMember };
