import Member from '../models/Member.js';
import House from '../models/House.js';

// @desc    Get all members
// @route   GET /api/members
// @access  Public
const getMembers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || "";
        const skip = (page - 1) * limit;

        const query = {};

        if (req.query.family) query.family = req.query.family;
        if (req.query.house) query.house = req.query.house;

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { name: searchRegex },
                { customId: searchRegex },
                { mobile: searchRegex }
            ];
        }

        const members = await Member.find(query)
            .populate('house', 'name customId')
            .populate('family', 'name customId')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Member.countDocuments(query);

        res.json({
            status: true,
            message: "Members fetched",
            data: {
                members,
                page,
                pages: Math.ceil(total / limit),
                total
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
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
            return res.status(404).json({ status: false, message: 'House not found' });
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

        res.status(201).json({ status: true, message: "Member created", data: member });
    } catch (error) {
        res.status(400).json({ status: false, message: error.message });
    }
};

// @desc    Update a member
// @route   PUT /api/members/:id
// @access  Private (Admin/Staff)
const updateMember = async (req, res) => {
    try {
        const member = await Member.findById(req.params.id);

        if (member) {
            // Update fields from request body if they exist
            Object.keys(req.body).forEach(key => {
                // Prevent updating customId or family/house relations directly here if need be (for now allowing all updates)
                if (key !== 'customId' && key !== '_id') {
                    member[key] = req.body[key];
                }
            });

            const updatedMember = await member.save();
            res.json({ status: true, message: "Member updated", data: updatedMember });
        } else {
            res.status(404).json({ status: false, message: 'Member not found' });
        }
    } catch (error) {
        res.status(400).json({ status: false, message: error.message });
    }
};

// @desc    Delete a member
// @route   DELETE /api/members/:id
// @access  Private (Admin)
const deleteMember = async (req, res) => {
    try {
        const member = await Member.findById(req.params.id);

        if (member) {
            await member.deleteOne();
            res.json({ status: true, message: 'Member removed' });
        } else {
            res.status(404).json({ status: false, message: 'Member not found' });
        }
    } catch (error) {
        res.status(400).json({ status: false, message: error.message });
    }
};

export { getMembers, createMember, updateMember, deleteMember };
