const User = require("../models/userModal");
const jwt = require("jsonwebtoken");
const OTP = require("../models/otpSchema");
const crypto = require("crypto");
const { ObjectId } = require("mongoose").Types;
const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utils/generateTokens");
const {
  sendOTPEmail,
  sendResetPasswordLink,
} = require("../utils/emailService");


// Initial signup - generate and send OTP
const initiateSignup = async (req, res) => {
  try {
    const { name, email, password, age, city, state, mobileNumber, role } =
      req.body;

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Generate OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    // Store OTP in database
    await OTP.findOneAndDelete({ email }); // Remove any existing OTP for this email
    await OTP.create({ email, otp });

    // Send OTP via email
    const emailSent = await sendOTPEmail(email, otp);

    if (!emailSent) {
      return res.status(500).json({ message: "Failed to send OTP" });
    }

    // Store signup data in session or temporary storage
    req.session.pendingSignup = {
      name,
      email,
      password,
      age,
      city,
      state,
      mobileNumber,
      role,
    };

    res.status(200).json({
      message: "OTP sent successfully",
      email,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Verify OTP and complete registration
const verifyOTPAndRegister = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Check if signup data exists in session
    const pendingSignup = req.session.pendingSignup;
    if (!pendingSignup) {
      return res.status(400).json({ message: "No pending signup found" });
    }

    // Verify OTP
    const otpRecord = await OTP.findOne({ email, otp });
    if (!otpRecord) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // Create user
    const user = await User.create({
      name: pendingSignup.name,
      email: pendingSignup.email,
      password: pendingSignup.password,
      age: pendingSignup.age,
      city: pendingSignup.city,
      state: pendingSignup.state,
      mobileNumber: pendingSignup.mobileNumber,
      role: pendingSignup.role,
    });

    // Delete the OTP record
    await OTP.findOneAndDelete({ email, otp });

    // Clear session signup data
    delete req.session.pendingSignup;

    // Generate tokens (implement these functions as per your authentication logic)
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshToken = refreshToken;
    await user.save();

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Authenticate a user
// @route   POST /api/v1/auth/login
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check for user
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Save refresh token to user
    user.refreshToken = refreshToken;
    await user.save();

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
const refreshToken = async (req, res) => {
  const { refreshToken } = req.body;

  try {
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Find user with the refresh token
    const user = await User.findOne({
      _id: decoded.id,
      refreshToken: refreshToken,
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user._id);

    res.json({ accessToken: newAccessToken });
  } catch (error) {
    res.status(401).json({ message: "Invalid refresh token" });
  }
};

// @desc    Logout user
// @route   POST /api/v1/auth/logout
const logoutUser = async (req, res) => {
  try {
    // Remove refresh token from user
    const user = await User.findById(req.user._id);
    user.refreshToken = undefined;
    await user.save();

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Import ObjectId from Mongoose at the top of your file
const getProfile = async (req, res) => {
  try {
    // Extract ID from request body
    const { id } = req.body;

    // Validate input
    if (!id) {
      return res.status(400).json({
        error: "INVALID_REQUEST",
        message: "User ID is required",
      });
    }
   // console.log("Requested profile ID:", id);

    // Ensure the requester is accessing their own profile
    // Fix: If the IDs do NOT match, then return an unauthorized error.
    const isValidOwnProfile = req.user._id.equals(new ObjectId(id));
    if (!isValidOwnProfile) {
      return res.status(403).json({
        error: "UNAUTHORIZED",
        message: "You can only access your own profile",
      });
    }

    // Find user by ID, excluding sensitive fields
    const user = await User.findById(id).select("-password -refreshToken -__v");
    //console.log("User lookup complete");

    // Check if user exists
    if (!user) {
      return res.status(404).json({
        error: "USER_NOT_FOUND",
        message: "No user found with the provided ID",
      });
    }

    // Construct profile response
    const profile = {
      name: user.name,
      email: user.email,
      age: user.age,
      city: user.city,
      mobile: user.mobile,
      state: user.state,
      mobileNumber: user.mobileNumber
    };

    // Successful response
    res.status(200).json({
      success: true,
      data: {...profile},
    });
  } catch (error) {
    console.error("Profile retrieval error:", error);

    // Handle specific Mongoose errors
    if (error.name === "CastError") {
      return res.status(400).json({
        error: "INVALID_ID",
        message: "The provided user ID is not valid",
      });
    }

    // Generic server error
    res.status(500).json({
      error: "SERVER_ERROR",
      message: "An unexpected error occurred while fetching the profile",
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No user found with this email address",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash the token and save to database
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // Token expires in 10 minutes
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000;

    await user.save();

    // Construct reset URL (replace with your frontend URL)
    const resetURL = `http://google.com/reset-password/${resetToken}`;

    const emailSent = await sendResetPasswordLink(email, resetURL);

    if (!emailSent) {
      return res
        .status(500)
        .json({ message: "Failed to send new password link" });
    }

    res.status(200).json({
      success: true,
      message: "Password reset email sent",
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    // Hash the token to compare with stored token
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    // Find user with matching token that hasn't expired
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    // Set new password
    user.password = newPassword; // This will trigger the pre-save hook to hash the password
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;

    await user.save();

    // // Optional: Send confirmation email
    // const mailOptions = {
    //   from: process.env.EMAIL_USER,
    //   to: user.email,
    //   subject: "Password Successfully Reset",
    //   text: "Your password has been successfully reset.",
    // };

    // await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    console.error("Password reset error:", error);
    res.status(500).json({
      success: false,
      message: "Error resetting password",
    });
  }
};

module.exports = {
  // registerUser,
  loginUser,
  refreshToken,
  logoutUser,
  getProfile,
  initiateSignup,
  verifyOTPAndRegister,
  forgotPassword,
  resetPassword
};
