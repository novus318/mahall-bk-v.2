import User from '../models/User.js';
import { generateAccessToken, generateRefreshToken } from '../utils/generateToken.js';
import jwt from 'jsonwebtoken';

// @desc    Auth user & get tokens
// @route   POST /api/auth/login
// @access  Public
const authUser = async (req, res) => {
    const { username, password } = req.body;

    const user = await User.findOne({ username });

    if (user && (await user.matchPassword(password))) {
        const accessToken = generateAccessToken(user._id);
        const refreshToken = generateRefreshToken(user._id);

        user.refreshToken = refreshToken;
        await user.save();

        res.json({
            _id: user._id,
            username: user.username,
            role: user.role,
            accessToken,
            refreshToken
        });
    } else {
        res.status(401).json({ message: 'Invalid username or password' });
    }
};

// @desc    Refresh Access Token
// @route   POST /api/auth/refresh
// @access  Public
const refreshAccessToken = async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }

    try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        const user = await User.findById(decoded.id);

        if (!user || user.refreshToken !== refreshToken) {
            return res.status(401).json({ message: 'Invalid refresh token' });
        }

        const accessToken = generateAccessToken(user._id);
        // Rotate refresh token (optional security measure, keeping same for now for simplicity unless requested)
        // For strict security, we should issue a new refresh token too.
        // Let's stick to simple access token refresh for now.

        res.json({ accessToken });
    } catch (error) {
        res.status(401).json({ message: 'Not authorized, token failed' });
    }
};

export { authUser, refreshAccessToken };
