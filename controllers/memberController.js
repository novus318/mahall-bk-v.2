import Member from '../models/Member.js';
import House from '../models/House.js';
import ExcelJS from 'exceljs';

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

        const andConditions = [];

        if (req.query.family) query.family = req.query.family;
        if (req.query.house) query.house = req.query.house;

        if (req.query.frequency && req.query.frequency !== 'ALL') {
            if (req.query.frequency === 'None') {
                andConditions.push({
                    $or: [
                        { 'subscription.frequency': 'None' },
                        { 'subscription.frequency': { $exists: false } }
                    ]
                });
            } else {
                andConditions.push({ 'subscription.frequency': req.query.frequency });
            }
        }

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            andConditions.push({
                $or: [
                    { name: searchRegex },
                    { customId: searchRegex },
                    { mobile: searchRegex },
                    { place: searchRegex }
                ]
            });
        }

        if (andConditions.length > 0) {
            query.$and = andConditions;
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
            // New Relationship Logic Inputs
            relatedMemberId,
            relationshipType // 'Wife', 'Son', 'Daughter', 'Brother', 'Sister', 'Father', 'Mother', 'Resident', etc.
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
            // Use house.customId length to safely slice
            const prefixLength = house.customId.length;
            const lastSeqStr = lastMember.customId.substring(prefixLength);
            const lastSeq = parseInt(lastSeqStr, 10);
            if (!isNaN(lastSeq)) {
                nextSeq = lastSeq + 1;
            }
        }

        // Pad with zeros to 2 digits
        const seqStr = nextSeq.toString().padStart(2, '0');
        const memberCustomId = `${house.customId}${seqStr}`;

        // Initial Member Data
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
            family: house.family ? house.family._id : undefined,
            relationshipToHead: relationshipType === 'Resident' ? 'Resident' : 'Other' // Default, updated logic below overrides if needed
        };

        // --- Relationship Inference Logic ---
        let parentsToSet = [];
        let spouseToSet = undefined;
        let childrenToSet = [];
        let siblingsToSet = [];

        if (relatedMemberId && relationshipType && relationshipType !== 'Resident') {
            const relatedMember = await Member.findById(relatedMemberId);

            if (!relatedMember) {
                return res.status(404).json({ status: false, message: 'Related member not found' });
            }

            // Case 1: Adding Spouse (Husband/Wife)
            if (relationshipType === 'Husband' || relationshipType === 'Wife') {
                spouseToSet = relatedMemberId;
                memberData.relationshipToHead = 'Spouse'; // Assuming relatedMember is Head, otherwise logic gets complex (Keep simple for now)

                // If related member is Head, this is Spouse. 
                // We should probably check if relatedMember has parents to determine precise 'Son-in-law' etc, but 'Spouse' is safe relative to that person.
            }

            // Case 2: Adding Child (Son/Daughter)
            else if (relationshipType === 'Son' || relationshipType === 'Daughter') {
                parentsToSet.push(relatedMemberId);
                // If related member has a spouse, add them as parent too
                if (relatedMember.spouse) {
                    parentsToSet.push(relatedMember.spouse);
                }
                memberData.relationshipToHead = relationshipType;
            }

            // Case 3: Adding Sibling (Brother/Sister)
            else if (relationshipType === 'Brother' || relationshipType === 'Sister') {
                // Copy parents from sibling
                if (relatedMember.parents && relatedMember.parents.length > 0) {
                    parentsToSet = [...relatedMember.parents];
                }
                siblingsToSet.push(relatedMemberId);
                // Also add other siblings? (Ideally yes, but let's link at least one)
                if (relatedMember.siblings && relatedMember.siblings.length > 0) {
                    siblingsToSet.push(...relatedMember.siblings);
                }
                memberData.relationshipToHead = relationshipType;
            }

            // Case 4: Adding Parent (Father/Mother)
            else if (relationshipType === 'Father' || relationshipType === 'Mother') {
                childrenToSet.push(relatedMemberId);
                // Check if related member has other parent defined?
                // Complex. For now, just link child.
                memberData.relationshipToHead = relationshipType;
            }
        } else if (relationshipType === 'Head') {
            memberData.relationshipToHead = 'Head';
            // Update House Head Logic? Handled separately usually, or we can set it here if house.head is empty
            if (!house.head) {
                // We'll do this update after creation
            }
        }

        memberData.parents = parentsToSet.length > 0 ? parentsToSet : undefined;
        memberData.spouse = spouseToSet;
        memberData.children = childrenToSet.length > 0 ? childrenToSet : undefined;
        memberData.siblings = siblingsToSet.length > 0 ? siblingsToSet : undefined;

        const member = new Member(memberData);
        const savedMember = await member.save();

        // --- Bi-directional Updates ---

        // 1. If Spouse Set -> Update Spouse
        if (spouseToSet) {
            await Member.findByIdAndUpdate(spouseToSet, { spouse: savedMember._id });
        }

        // 2. If Parents Set -> Update Parents' Children
        if (parentsToSet.length > 0) {
            await Member.updateMany(
                { _id: { $in: parentsToSet } },
                { $push: { children: savedMember._id } }
            );
        }

        // 3. If Children Set -> Update Children's Parents
        if (childrenToSet.length > 0) {
            await Member.updateMany(
                { _id: { $in: childrenToSet } },
                { $push: { parents: savedMember._id } }
            );
        }

        // 4. If Siblings Set -> Update Siblings' Siblings List
        if (siblingsToSet.length > 0) {
            await Member.updateMany(
                { _id: { $in: siblingsToSet } },
                { $push: { siblings: savedMember._id } }
            );
        }

        // 5. Special House Head Handling
        if (relationshipType === 'Head' || (!house.head && !relatedMemberId && relationshipType !== 'Resident')) {
            await House.findByIdAndUpdate(houseId, { head: savedMember._id });
            // Also update member to say 'Head' just in case
            if (member.relationshipToHead !== 'Head') {
                member.relationshipToHead = 'Head';
                await member.save();
            }
        }

        res.status(201).json({ status: true, message: "Member created", data: member });
    } catch (error) {
        res.status(400).json({ status: false, message: error.message });
    }
};

// @desc    Update a member
// @route   PUT /api/members/:id
// @access  Private (Admin/Staff)
// @route   PUT /api/members/:id
// @access  Private (Admin/Staff)
// @route   PUT /api/members/:id
// @access  Private (Admin/Staff)
const updateMember = async (req, res) => {
    try {
        const { relatedMemberId, relationshipType, ...updateData } = req.body;
        const member = await Member.findById(req.params.id);

        if (member) {
            // Update basic fields
            Object.keys(updateData).forEach(key => {
                if (key !== 'customId' && key !== '_id' && key !== 'house' && key !== 'family') {
                    member[key] = updateData[key];
                }
            });

            // Logic to update relationships if provided
            if (relationshipType) {
                // 0. Clear Old Relationships (Spouse & Parents - defining links)
                // If we are changing relationship, we assume the old position is invalid.

                // Clear Spouse
                if (member.spouse) {
                    await Member.findByIdAndUpdate(member.spouse, { $unset: { spouse: 1 } });
                    member.spouse = undefined;
                }

                // Clear Parents (Remove self from their children list)
                if (member.parents && member.parents.length > 0) {
                    await Member.updateMany(
                        { _id: { $in: member.parents } },
                        { $pull: { children: member._id } }
                    );
                    member.parents = [];
                }

                member.relationshipToHead = relationshipType === 'Resident' ? 'Resident' : relationshipType;

                if (relatedMemberId && relationshipType !== 'Resident') {
                    const relatedMember = await Member.findById(relatedMemberId);
                    if (relatedMember) {
                        // 1. Spouse
                        if (relationshipType === 'Husband' || relationshipType === 'Wife') {
                            member.spouse = relatedMemberId;
                            // Ensure related member also doesn't have a conflict? (Optional, but good safety)
                            if (relatedMember.spouse && relatedMember.spouse.toString() !== member._id.toString()) {
                                // Clear their old spouse? Or error? Let's overwrite for now.
                                await Member.findByIdAndUpdate(relatedMember.spouse, { $unset: { spouse: 1 } });
                            }
                            await Member.findByIdAndUpdate(relatedMemberId, { spouse: member._id });
                        }
                        // 2. Child (Son/Daughter)
                        else if (relationshipType === 'Son' || relationshipType === 'Daughter') {
                            // If they have a spouse (mother/father), add them too? 
                            // For simplicity, just add the selected parent.
                            member.parents.push(relatedMemberId);
                            await Member.findByIdAndUpdate(relatedMemberId, { $addToSet: { children: member._id } });

                            // Try to auto-link other parent if selected parent has a spouse
                            if (relatedMember.spouse) {
                                member.parents.push(relatedMember.spouse);
                                await Member.findByIdAndUpdate(relatedMember.spouse, { $addToSet: { children: member._id } });
                            }
                        }
                        // 3. Parent (Father/Mother)
                        else if (relationshipType === 'Father' || relationshipType === 'Mother') {
                            if (!member.children.includes(relatedMemberId)) {
                                member.children.push(relatedMemberId);
                                await Member.findByIdAndUpdate(relatedMemberId, { $addToSet: { parents: member._id } });
                            }
                        }
                    }
                }
            }

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

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.getWorksheet(1);
        
        // Convert worksheet to array of objects (similar to xlsx.utils.sheet_to_json)
        const data = [];
        const headers = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) {
                row.eachCell((cell) => {
                    headers.push(cell.value);
                });
            } else {
                const rowData = {};
                row.eachCell((cell, colNumber) => {
                    const header = headers[colNumber - 1];
                    rowData[header] = cell.value;
                });
                data.push(rowData);
            }
        });

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
                        whatsapp: row.WhatsApp,
                        bloodGroup: row.BloodGroup,
                        maritalStatus: row.MaritalStatus,
                        education: row.Education,
                        madrassa: row.Madrassa,
                        occupation: row.Occupation,
                        place: row.Place,
                        house: house._id,
                        family: house.family ? house.family._id : undefined,
                        idCards: {
                            aadhaar: ['yes', 'true', '1'].includes(String(row.ID_Aadhaar || '').toLowerCase()),
                            drivingLicense: ['yes', 'true', '1'].includes(String(row.ID_DrivingLicense || '').toLowerCase()),
                            voterId: ['yes', 'true', '1'].includes(String(row.ID_VoterID || '').toLowerCase()),
                            panCard: ['yes', 'true', '1'].includes(String(row.ID_PAN || '').toLowerCase()),
                            healthCard: ['yes', 'true', '1'].includes(String(row.ID_HealthCard || '').toLowerCase())
                        }
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
                const relatedCustomId = row.RelatedMemberID;
                const relationshipType = row.Relationship ? String(row.Relationship).trim().toLowerCase() : null;

                if (!relatedCustomId) continue;

                const relatedMemberId = await findMemberIdByCustomId(relatedCustomId);

                if (!relatedMemberId) {
                    warnings.push(`Warning: Related Member ID '${relatedCustomId}' not found for '${doc.name}'`);
                    continue;
                }

                const relatedMemberDoc = await Member.findById(relatedMemberId);

                if (!relationshipType) continue;

                try {
                    // Logic: "I am [relationshipType] of [relatedMemberId]"
                    if (['husband', 'wife', 'spouse'].includes(relationshipType)) {
                        await Member.findByIdAndUpdate(doc._id, { spouse: relatedMemberId });
                        await Member.findByIdAndUpdate(relatedMemberId, { spouse: doc._id });
                    }
                    else if (['son', 'daughter', 'child'].includes(relationshipType)) {
                        // They are my parent
                        const parents = [relatedMemberId];
                        if (relatedMemberDoc && relatedMemberDoc.spouse) parents.push(relatedMemberDoc.spouse);

                        await Member.findByIdAndUpdate(doc._id, { $addToSet: { parents: { $each: parents } } });

                        // Add me to their children
                        await Member.findByIdAndUpdate(relatedMemberId, { $addToSet: { children: doc._id } });
                        if (relatedMemberDoc && relatedMemberDoc.spouse) {
                            await Member.findByIdAndUpdate(relatedMemberDoc.spouse, { $addToSet: { children: doc._id } });
                        }
                    }
                    else if (['father', 'mother', 'parent'].includes(relationshipType)) {
                        // I am their parent -> They are my child
                        // Add them to my children
                        await Member.findByIdAndUpdate(doc._id, { $addToSet: { children: relatedMemberId } });

                        // Add me to their parents
                        await Member.findByIdAndUpdate(relatedMemberId, { $addToSet: { parents: doc._id } });
                    }
                    else if (['brother', 'sister', 'sibling'].includes(relationshipType)) {
                        // We share parents
                        if (relatedMemberDoc && relatedMemberDoc.parents && relatedMemberDoc.parents.length > 0) {
                            await Member.findByIdAndUpdate(doc._id, { $addToSet: { parents: { $each: relatedMemberDoc.parents } } });
                            // Add me to common parents' children
                            for (const pId of relatedMemberDoc.parents) {
                                await Member.findByIdAndUpdate(pId, { $addToSet: { children: doc._id } });
                            }
                        }
                    }
                } catch (err) {
                    warnings.push(`Warning: Failed to link '${doc.name}' as ${relationshipType} of ${relatedCustomId}: ${err.message}`);
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

// @desc    Get member by ID
// @route   GET /api/members/:id
// @access  Private (Admin/Staff)
const getMemberById = async (req, res) => {
    try {
        const member = await Member.findById(req.params.id)
            .populate('house', 'name customId')
            .populate('family', 'name customId');

        if (member) {
            res.json({ status: true, data: member });
        } else {
            res.status(404).json({ status: false, message: 'Member not found' });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Move out / Disable a member
// @route   PUT /api/members/:id/move-out
// @access  Private (Admin/Staff)
const moveOutMember = async (req, res) => {
    try {
        const member = await Member.findById(req.params.id);

        if (member) {
            member.status = 'Moved Out';
            // Clear subscription
            if (member.subscription) {
                member.subscription.frequency = 'None';
                member.subscription.amount = 0;
            } else {
                member.subscription = { frequency: 'None', amount: 0 };
            }

            const updatedMember = await member.save();
            res.json({ status: true, message: "Member moved out successfully", data: updatedMember });
        } else {
            res.status(404).json({ status: false, message: 'Member not found' });
        }
    } catch (error) {
        res.status(400).json({ status: false, message: error.message });
    }
};

export { getMembers, getMemberById, createMember, updateMember, deleteMember, bulkImportMembers, moveOutMember };
