import Family from '../models/Family.js';
import xlsx from 'xlsx';

// @desc    Get all families
// @route   GET /api/families
// @access  Public
// @desc    Get all families
// @route   GET /api/families
// @access  Public
const getFamilies = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';

        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { customId: { $regex: search, $options: 'i' } }
            ];
        }

        const count = await Family.countDocuments(query);
        const families = await Family.find(query)
            .limit(limit)
            .skip(limit * (page - 1))
            .sort({ createdAt: -1 });

        res.json({
            status: true,
            message: "Families fetched successfully",
            data: {
                families,
                page,
                pages: Math.ceil(count / limit),
                total: count
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get single family
// @route   GET /api/families/:id
// @access  Public
const getFamilyById = async (req, res) => {
    try {
        const family = await Family.findById(req.params.id);
        if (family) {
            res.json({ status: true, message: "Family details", data: family });
        } else {
            res.status(404).json({ status: false, message: 'Family not found' });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Create a new family
// @route   POST /api/families
// @access  Public
const createFamily = async (req, res) => {
    try {
        const { name, customId, description } = req.body;

        const familyExists = await Family.findOne({ customId });

        if (familyExists) {
            return res.status(400).json({ status: false, message: 'Family ID already exists' });
        }

        if (customId.length !== 3) {
            return res.status(400).json({ status: false, message: 'Family ID must be exactly 3 characters' });
        }

        const family = await Family.create({
            name,
            customId: customId.toUpperCase(),
            description
        });

        res.status(201).json({ status: true, message: "Family created", data: family });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ status: false, message: 'Family with this name already exists' });
        }
        res.status(400).json({ status: false, message: error.message });
    }
};

// @desc    Update a family
// @route   PUT /api/families/:id
// @access  Private (Admin/Staff)
const updateFamily = async (req, res) => {
    try {
        const { name, description } = req.body;
        const family = await Family.findById(req.params.id);

        if (family) {
            family.name = name || family.name;
            family.description = description || family.description;

            const updatedFamily = await family.save();
            res.json({ status: true, message: "Family updated", data: updatedFamily });
        } else {
            res.status(404).json({ status: false, message: 'Family not found' });
        }
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ status: false, message: 'Family with this name already exists' });
        }
        res.status(400).json({ status: false, message: error.message });
    }
};

// @desc    Delete a family
// @route   DELETE /api/families/:id
// @access  Private (Admin)
const deleteFamily = async (req, res) => {
    try {
        const family = await Family.findById(req.params.id);

        if (family) {
            await family.deleteOne();
            res.json({ status: true, message: 'Family removed' });
        } else {
            res.status(404).json({ status: false, message: 'Family not found' });
        }
    } catch (error) {
        res.status(400).json({ status: false, message: error.message });
    }
};

// @desc    Bulk import families from Excel
// @route   POST /api/families/import
// @access  Private (Admin/Staff)
const bulkImportFamilies = async (req, res) => {
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

        for (const row of data) {
            // Trim and clean data
            const name = row.name ? String(row.name).trim() : null;
            let customId = row.customId ? String(row.customId).trim() : null;
            if (customId) {
                customId = customId.padStart(3, '0');
            }
            const description = row.description ? String(row.description).trim() : '';

            if (!name || !customId) {
                errorCount++;
                errors.push(`Skipped row: Missing name or customId`);
                continue;
            }

            if (customId.length !== 3) {
                errorCount++;
                errors.push(`Skipped ${name}: ID must be 3 characters (got '${customId}')`);
                continue;
            }

            try {
                // Check if exists (Name or ID)
                // We do this check one by one to give specific error feedback without crashing
                const existingId = await Family.findOne({ customId: customId.toUpperCase() });
                if (existingId) {
                    errorCount++;
                    errors.push(`Skipped ${name}: ID '${customId}' already exists`);
                    continue;
                }

                const existingName = await Family.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
                if (existingName) {
                    errorCount++;
                    errors.push(`Skipped ${name}: Name already exists`);
                    continue;
                }

                await Family.create({
                    name,
                    customId: customId.toUpperCase(),
                    description
                });
                successCount++;
            } catch (err) {
                errorCount++;
                errors.push(`Error creating ${name}: ${err.message}`);
            }
        }

        res.json({
            status: true,
            message: `Import processed. Added: ${successCount}, Failed: ${errorCount}`,
            data: { successCount, errorCount, errors }
        });

    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export { getFamilies, getFamilyById, createFamily, updateFamily, deleteFamily, bulkImportFamilies };
