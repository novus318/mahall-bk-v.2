import Member from '../models/Member.js';
import House from '../models/House.js';
import xlsx from 'xlsx';

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

const bulkImportMembers = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: false, message: 'Please upload an Excel file' });
        }

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        if (!data || data.length === 0) {
            return res.status(400).json({ status: false, message: 'Excel file is empty' });
        }

        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        const warnings = [];

        // 1. Group by House Custom ID (e.g., 'CYS101')
        const groups = {};
        for (const row of data) {
            // Normalize keys (handle case sensitivity if needed, but assuming template matches)
            const houseKey = row.HouseID ? String(row.HouseID).trim().toUpperCase() : 'UNKNOWN';
            if (!groups[houseKey]) groups[houseKey] = [];
            groups[houseKey].push(row);
        }

        // Pre-fetch Houses
        const houseCustomIds = Object.keys(groups).filter(k => k !== 'UNKNOWN');
        const housesDocs = await House.find({ customId: { $in: houseCustomIds } }).populate('family');
        const houseMap = new Map(); // customId -> HouseDoc
        housesDocs.forEach(h => houseMap.set(h.customId, h));

        // 2. Process Each House Group
        for (const [houseKey, rows] of Object.entries(groups)) {
            if (houseKey === 'UNKNOWN') {
                rows.forEach(r => {
                    errorCount++;
                    errors.push(`Row '${r.Name}': Missing HouseID`);
                });
                continue;
            }

            const house = houseMap.get(houseKey);
            if (!house) {
                rows.forEach(r => {
                    errorCount++;
                    errors.push(`Row '${r.Name}': House '${houseKey}' not found`);
                });
                continue;
            }

            // Get last sequence for this house to start ID generation
            const lastMember = await Member.findOne({ house: house._id }).sort({ createdAt: -1 });
            let nextSeq = 1;
            if (lastMember) {
                const lastSeqStr = lastMember.customId.substring(houseKey.length);
                const lastSeqInt = parseInt(lastSeqStr, 10);
                if (!isNaN(lastSeqInt)) nextSeq = lastSeqInt + 1;
            }

            const createdMembersInBatch = [];

            // PASS 1: Create Members (Basic Info)
            for (const row of rows) {
                try {
                    const name = row.Name ? String(row.Name).trim() : null;
                    if (!name) {
                        errorCount++;
                        errors.push(`Skipped row in ${houseKey}: Missing Name`);
                        continue;
                    }

                    const gender = row.Gender ? String(row.Gender).trim() : 'Male'; // Default or validate
                    const dob = row.DOB ? new Date(row.DOB) : null;

                    // Generate ID
                    const seqStr = nextSeq.toString().padStart(2, '0');
                    const memberCustomId = `${house.customId}${seqStr}`;
                    nextSeq++;

                    const newMember = new Member({
                        name,
                        customId: memberCustomId,
                        gender,
                        dateOfBirth: dob,
                        mobile: row.Mobile,
                        bloodGroup: row.BloodGroup,
                        maritalStatus: row.MaritalStatus,
                        house: house._id,
                        family: house.family ? house.family._id : undefined
                    });

                    const savedMember = await newMember.save();
                    createdMembersInBatch.push({ doc: savedMember, row });
                    successCount++;
                } catch (err) {
                    errorCount++;
                    errors.push(`Failed to create '${row.Name}': ${err.message}`);
                }
            }

            // PASS 2: Match Relationships (Update Parents/Spouse using CustomID)
            // The user provides CustomID (e.g. CYS10101) for relationships

            // Helper to find ID by CustomID (from DB or current batch if we want to support that? 
            // Current batch members are in 'createdMembersInBatch' but we need their new CustomID)
            // Let's re-fetch or use the map.

            const findMemberIdByCustomId = async (cid) => {
                if (!cid) return null;
                const normalizedCid = String(cid).trim().toUpperCase();
                // 1. Check current batch (in memory)
                const inBatch = createdMembersInBatch.find(item => item.doc.customId === normalizedCid);
                if (inBatch) return inBatch.doc._id;

                // 2. Check DB
                const m = await Member.findOne({ customId: normalizedCid }).select('_id');
                return m ? m._id : null;
            };

            for (const { doc, row } of createdMembersInBatch) {
                const fatherId = row.FatherID ? await findMemberIdByCustomId(row.FatherID) : null;
                const motherId = row.MotherID ? await findMemberIdByCustomId(row.MotherID) : null;
                const spouseId = row.SpouseID ? await findMemberIdByCustomId(row.SpouseID) : null;

                if (row.FatherID && !fatherId) warnings.push(`Warning: Father ID '${row.FatherID}' not found for '${doc.name}'`);
                if (row.MotherID && !motherId) warnings.push(`Warning: Mother ID '${row.MotherID}' not found for '${doc.name}'`);
                if (row.SpouseID && !spouseId) warnings.push(`Warning: Spouse ID '${row.SpouseID}' not found for '${doc.name}'`);

                const pArr = [];
                if (fatherId) pArr.push(fatherId);
                if (motherId) pArr.push(motherId);

                if (pArr.length > 0 || spouseId) {
                    await Member.findByIdAndUpdate(doc._id, {
                        parents: pArr.length > 0 ? pArr : undefined,
                        spouse: spouseId
                    });
                }
            }
        }

        res.json({
            status: true,
            message: 'Bulk import completed',
            data: {
                successCount,
                errorCount,
                errors,
                warnings
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: error.message });
    }
};

export { getMembers, createMember, updateMember, deleteMember, bulkImportMembers };
