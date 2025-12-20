import User from '../models/User.js';
import bcrypt from 'bcryptjs';

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
const getUsers = async (req, res) => {
    try {
        const users = await User.find({ _id: { $ne: req.user._id } }).select('-password');
        res.json({ status: true, data: users });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Create a new user
// @route   POST /api/users
// @access  Private/Admin
const createUser = async (req, res) => {
    const { username, password, role, name, contactNumber } = req.body;

    try {
        const userExists = await User.findOne({ username });

        if (userExists) {
            return res.status(400).json({ status: false, message: 'User already exists' });
        }

        const user = await User.create({
            username,
            password,
            role,
            name,
            contactNumber
        });

        if (user) {
            res.status(201).json({
                status: true,
                message: 'User created successfully',
                data: {
                    _id: user._id,
                    username: user.username,
                    role: user.role,
                    name: user.name
                }
            });
        } else {
            res.status(400).json({ status: false, message: 'Invalid user data' });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update user details
// @route   PUT /api/users/:id
// @access  Private/Admin
const updateUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (user) {
            user.username = req.body.username || user.username;
            user.role = req.body.role || user.role;
            user.name = req.body.name || user.name;
            user.contactNumber = req.body.contactNumber || user.contactNumber;

            const updatedUser = await user.save();

            res.json({
                status: true,
                message: 'User updated successfully',
                data: {
                    _id: updatedUser._id,
                    username: updatedUser.username,
                    role: updatedUser.role,
                    name: updatedUser.name
                }
            });
        } else {
            res.status(404).json({ status: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (user) {
            await user.deleteOne();
            res.json({ status: true, message: 'User removed' });
        } else {
            res.status(404).json({ status: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Admin reset user password
// @route   PUT /api/users/:id/reset-password
// @access  Private/Admin
const resetUserPassword = async (req, res) => {
    const { password } = req.body;
    try {
        const user = await User.findById(req.params.id);

        if (user) {
            user.password = password;
            await user.save();
            res.json({ status: true, message: 'Password reset successfully' });
        } else {
            res.status(404).json({ status: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Get own profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (user) {
            res.json({
                status: true,
                data: {
                    _id: user._id,
                    username: user.username,
                    name: user.name,
                    contactNumber: user.contactNumber,
                    role: user.role
                }
            });
        } else {
            res.status(404).json({ status: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Update own profile
// @route   PUT /api/users/profile
// @access  Private
const updateProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (user) {
            user.name = req.body.name || user.name;
            user.contactNumber = req.body.contactNumber || user.contactNumber;
            // Username cannot be changed by user themselves policy can be added

            const updatedUser = await user.save();

            res.json({
                status: true,
                message: 'Profile updated successfully',
                data: {
                    _id: updatedUser._id,
                    username: updatedUser.username,
                    name: updatedUser.name,
                    contactNumber: updatedUser.contactNumber,
                    role: updatedUser.role
                }
            });
        } else {
            res.status(404).json({ status: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

// @desc    Change own password
// @route   PUT /api/users/profile/password
// @access  Private
const changePassword = async (req, res) => {
    const { newPassword } = req.body;
    try {
        const user = await User.findById(req.user._id);

        if (user) {
            user.password = newPassword;
            await user.save();
            res.json({ status: true, message: 'Password changed successfully' });
        } else {
            res.status(404).json({ status: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

export {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    resetUserPassword,
    getUserProfile,
    updateProfile,
    changePassword
};
