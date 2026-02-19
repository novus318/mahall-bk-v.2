import House from '../models/House.js';
import Family from '../models/Family.js';
import Member from '../models/Member.js';
import ExcelJS from 'exceljs';

// @desc    Get all houses
// @route   GET /api/houses
// @access  Public
// @desc    Get all houses
// @route   GET /api/houses
// @access  Public
const getHouses = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';

        const query = {};
        const andConditions = [];

        if (req.query.family) {
            andConditions.push({ family: req.query.family });
        }

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
            andConditions.push({
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { customId: { $regex: search, $options: 'i' } },
                    { address: { $regex: search, $options: 'i' } }
                ]
            });
        }

        if (andConditions.length > 0) {
            query.$and = andConditions;
        }

        const count = await House.countDocuments(query);
        const houses = await House.find(query)
            .populate('family', 'name customId')
            .limit(limit)
            .skip(limit * (page - 1))
            .sort({ createdAt: -1 });

        res.json({
            status: true,
            message: "Houses fetched successfully",
            data: {
                houses,
                page,
                pages: Math.ceil(count / limit),
                total: count
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get single house
// @route   GET /api/houses/:id
// @access  Public
const getHouseById = async (req, res) => {
    try {
        const house = await House.findById(req.params.id).populate('family', 'name customId');
        if (house) {
            res.json({ status: true, message: "House details", data: house });
        } else {
            res.status(404).json({ status: false, message: 'House not found' });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
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
                return res.status(404).json({ status: false, message: 'Family not found' });
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

        res.status(201).json({ status: true, message: "House created", data: house });
    } catch (error) {
        res.status(400).json({ status: false, message: error.message });
    }
};

// @desc    Update a house
// @route   PUT /api/houses/:id
// @access  Private (Admin/Staff)
// @desc    Update a house
// @route   PUT /api/houses/:id
// @access  Private (Admin/Staff)
const updateHouse = async (req, res) => {
    try {
        const { name, address } = req.body;
        const house = await House.findById(req.params.id);

        if (house) {
            house.name = name !== undefined ? name : house.name;
            house.address = address !== undefined ? address : house.address;

            if (req.body.head !== undefined && req.body.head !== (house.head ? house.head.toString() : null)) {
                const oldHeadId = house.head;
                const newHeadId = req.body.head;

                // Update Old Head (Demote to Resident)
                if (oldHeadId) {
                    await Member.findByIdAndUpdate(oldHeadId, { relationshipToHead: 'Resident' });
                }

                // Update New Head (Promote to Head)
                if (newHeadId) {
                    await Member.findByIdAndUpdate(newHeadId, { relationshipToHead: 'Head' });
                }

                house.head = newHeadId;
            }

            const updatedHouse = await house.save();
            res.json({ status: true, message: "House updated", data: updatedHouse });
        } else {
            res.status(404).json({ status: false, message: 'House not found' });
        }
    } catch (error) {
        res.status(400).json({ status: false, message: error.message });
    }
};

// @desc    Delete a house
// @route   DELETE /api/houses/:id
// @access  Private (Admin)
const deleteHouse = async (req, res) => {
    try {
        const house = await House.findById(req.params.id);

        if (house) {
            await house.deleteOne();
            res.json({ status: true, message: 'House removed' });
        } else {
            res.status(404).json({ status: false, message: 'House not found' });
        }
    } catch (error) {
        res.status(400).json({ status: false, message: error.message });
    }
};

// @desc    Bulk import houses from Excel
// @route   POST /api/houses/import
// @access  Private (Admin/Staff)

const bulkImportHouses = async (req, res) => {
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

        // 1. Group rows by Family Custom ID (or 'IND' if undefined)
        // This is necessary to generate sequential IDs correctly for each family
        const groups = {}; // { 'CYS': [row1, row2], 'IND': [row3] }

        for (const row of data) {
            const familyKey = row.familyCustomId ? String(row.familyCustomId).trim().toUpperCase().padStart(3, '0') : 'IND';
            if (!groups[familyKey]) {
                groups[familyKey] = [];
            }
            groups[familyKey].push(row);
        }

        // Pre-fetch all families map for validation
        const families = await Family.find({});
        const familyMap = new Map(); // customId -> _id
        families.forEach(f => familyMap.set(f.customId, f._id));

        // 2. Process each group
        for (const [key, rows] of Object.entries(groups)) {
            let familyId = null;
            let familyPrefix = 'IND';

            // Validate Family
            if (key !== 'IND') {
                if (familyMap.has(key)) {
                    familyId = familyMap.get(key);
                    familyPrefix = key;
                } else {
                    // Entire group fails if family doesn't exist
                    // Or we could skip just these rows. Let's skip and log errors.
                    for (const r of rows) {
                        errorCount++;
                        errors.push(`Skipped House ${r.block}-${r.houseNumber}: Family '${key}' not found`);
                    }
                    continue;
                }
            }

            // Find current last sequence for this family
            const query = (key === 'IND') ? { family: { $exists: false } } : { family: familyId };
            // Sort by customId desc is reliable because format is fixed length (AAA000)
            const lastHouse = await House.findOne(query).sort({ customId: -1 });

            let nextSeq = 1;
            if (lastHouse) {
                const lastSeqStr = lastHouse.customId.substring(3);
                const lastSeq = parseInt(lastSeqStr, 10);
                if (!isNaN(lastSeq)) {
                    nextSeq = lastSeq + 1;
                }
            }

            // Process rows in this group
            for (const row of rows) {
                let name = row.name ? String(row.name).trim() : null;
                let customId = row.customId ? String(row.customId).trim() : null;
                const address = row.address ? String(row.address).trim() : '';

                // Fallback to Block/Number generation if name/customId not provided
                if (!name && row.block && row.houseNumber) {
                    name = `${row.block}-${row.houseNumber}`;
                }

                // Validation
                if (!name) {
                    errorCount++;
                    errors.push(`Skipped row: Missing 'name' (or block/houseNumber)`);
                    continue;
                }

                // Auto-generate Custom ID if not provided
                if (!customId) {
                    const seqStr = nextSeq.toString().padStart(3, '0');
                    customId = `${familyPrefix}${seqStr}`;
                    nextSeq++;
                }

                // Optional: Check if customId format is valid (matches family prefix) if manually provided? 
                // For now, let's trust the input or schema validation.

                try {
                    await House.create({
                        name,
                        customId,
                        address,
                        family: familyId
                    });
                    successCount++;
                    // Only increment sequence if we GENERATED the ID. 
                    // If user provided ID, we shouldn't necessarily increment nextSeq unless we want to keep them in sync, 
                    // but mixing manual/auto is complex. Let's assume if they provide ID, they manage the sequence.
                    // But if we generated it, we incremented it above.
                } catch (err) {
                    errorCount++;
                    if (err.code === 11000) {
                        errors.push(`Skipped House ${name}: Duplicate Key (${customId})`);
                    } else {
                        errors.push(`Skipped House ${name}: ${err.message}`);
                    }
                }
            }
        }

        res.status(200).json({
            status: true,
            message: `Import processed. Added: ${successCount}, Skipped: ${errorCount}`,
            data: {
                successCount,
                errorCount,
                errors
            }
        });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export { getHouses, getHouseById, createHouse, updateHouse, deleteHouse, bulkImportHouses };
