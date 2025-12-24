import User from "../module/UserModule.js";
import Article from "../module/ArticleModel.js";
import { calculateReadTime } from "../../utils/readTime.js";

/* =================
  1. Get User Profile
================= */
export const getUserProfile = async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId)
      .select("-password") // hide password
      .populate({
        path: "followers following",
        select: "username profileImage",
      });

    if (!user) return res.status(404).json({ message: "User not found" });

    const articles = await Article.find({ author: userId })
      .select("title views status category readTime image createdAt");

    res.json({
      success: true,
      user,
      articles,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =================
  2. Edit User Profile
================= */
export const editUserProfile = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware
    const updatedData = { ...req.body };

    // Profile image upload
    if (req.file) {
      updatedData.profileImage = `/uploads/profiles/${req.file.filename}`;
    }

    const user = await User.findByIdAndUpdate(userId, updatedData, { new: true })
      .select("-password");

    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =================
  3. Follow / Unfollow User
================= */
export const toggleFollow = async (req, res) => {
  try {
    const userId = req.user.id;
    const targetId = req.params.id;

    if (userId === targetId)
      return res.status(400).json({ message: "Cannot follow yourself" });

    const user = await User.findById(userId);
    const targetUser = await User.findById(targetId);

    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const alreadyFollowing = user.following.includes(targetId);

    if (alreadyFollowing) {
      // Unfollow
      user.following.pull(targetId);
      targetUser.followers.pull(userId);
    } else {
      // Follow
      user.following.push(targetId);
      targetUser.followers.push(userId);
    }

    await user.save();
    await targetUser.save();

    res.json({ success: true, following: !alreadyFollowing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
